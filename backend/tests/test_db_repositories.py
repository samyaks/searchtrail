"""Repositories, especially the seams WS-B2 writes through (docs/PHASE1_PLAN.md)."""
from __future__ import annotations

import threading
from datetime import UTC, datetime

import pytest
from pydantic import ValidationError
from sqlalchemy import select
from sqlalchemy.exc import IntegrityError

from app.db import repositories
from app.db.base import new_id
from app.db.models import AuditEntryRow, CustodianRow, MatterRow, PreviewItemRow, QueryVersionRow, SiteRow, UserRow
from searchtrail.audit import AuditLog, canonical


def add_matter(s, number: str = "M-1") -> MatterRow:
    matter = MatterRow(id=new_id("mat"), matter_number=number, name=number, type="investigation")
    s.add(matter)
    s.flush()
    return matter


def add_version(s, matter: MatterRow) -> QueryVersionRow:
    version = QueryVersionRow(id=new_id("qv"), matter_id=matter.id, version=1, criteria={}, kql="k", kql_sha256="0" * 64,
                              methodology=[], sources_fingerprint="0" * 64)
    s.add(version)
    s.flush()
    return version


# -- runs and preview items ------------------------------------------------------------------------
def test_a_run_starts_running_and_finishes_with_counts(sessions):
    with sessions() as s:
        version = add_version(s, add_matter(s))
        run = repositories.create_run(s, matter_id=version.matter_id, query_version_id=version.id, kind="preview",
                                      created_by=None)
        assert run.status == "running" and run.finished_at is None and run.files == []
        counts = {"items": 630, "size_bytes": 1, "partial_items": 25, "partial_size_bytes": 1, "mailboxes": 2, "sites": 3}
        repositories.finish_run(s, run, status="succeeded", counts=counts, result={"by_type": []},
                                files=[{"name": "report.csv"}])
        s.commit()
        assert (run.status, run.counts, run.files) == ("succeeded", counts, [{"name": "report.csv"}])
        assert run.finished_at is not None


def test_a_run_finishes_once_with_valid_counts(sessions):
    with sessions() as s:
        version = add_version(s, add_matter(s))
        run = repositories.create_run(s, matter_id=version.matter_id, query_version_id=version.id, kind="estimate",
                                      created_by=None)
        with pytest.raises(ValidationError):  # the Matters list reads items and partial_items
            repositories.finish_run(s, run, status="succeeded", counts={"items": 10})
        assert run.status == "running"
        repositories.finish_run(s, run, status="failed")
        with pytest.raises(ValueError, match="already finished"):  # a resumed job can't overwrite the result
            repositories.finish_run(s, run, status="succeeded")
        assert run.status == "failed"


def test_runs_refuse_unknown_kinds_and_statuses(sessions):
    with sessions() as s:
        version = add_version(s, add_matter(s))
        with pytest.raises(ValueError, match="kind"):
            repositories.create_run(s, matter_id=version.matter_id, query_version_id=version.id, kind="export",
                                    created_by=None)
        run = repositories.create_run(s, matter_id=version.matter_id, query_version_id=version.id, kind="estimate",
                                      created_by=None)
        with pytest.raises(ValueError, match="status"):
            repositories.finish_run(s, run, status="running")


def test_preview_items_are_written_in_batches_from_a_generator(sessions):
    with sessions() as s:
        version = add_version(s, add_matter(s))
        run = repositories.create_run(s, matter_id=version.matter_id, query_version_id=version.id, kind="preview",
                                      created_by=None)
        items = ({"item_id": f"i{n}", "title": f"Item {n}", "location": "alex@contoso.com", "type": "email",
                  "date": datetime(2025, 1, 1, tzinfo=UTC), "label": None, "size_bytes": n, "encrypted": False}
                 for n in range(2_345))
        assert repositories.add_preview_items(s, run.id, items, batch_size=500) == 2_345
        s.commit()
        assert len(s.scalars(select(PreviewItemRow.id).where(PreviewItemRow.run_id == run.id)).all()) == 2_345

        with pytest.raises(ValueError, match="sizeBytes"):
            repositories.add_preview_items(s, run.id, [{"item_id": "x", "type": "email", "sizeBytes": 1}])


# -- the log ---------------------------------------------------------------------------------------
def test_each_matter_has_its_own_chain_in_the_cli_format(sessions, tmp_path):
    with sessions() as s:
        falcon, other = add_matter(s, "M-1"), add_matter(s, "M-2")
        for n in range(3):
            repositories.append_log(s, falcon.id, "estimate", actor="Dana Whitfield",
                                    actor_email="dana.whitfield@contoso.com", summary=f"Query v{n + 1}",
                                    version=n + 1, kql="kickback", counts={"items": n})
        repositories.append_log(s, other.id, "export_finished", actor=repositories.SYSTEM_ACTOR, actor_email=None,
                                summary="Ready in Purview")
        s.commit()
        entries = s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == falcon.id)
                            .order_by(AuditEntryRow.seq)).all()
        [system] = s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == other.id)).all()

    assert [e.seq for e in entries] == [1, 2, 3] and system.seq == 1
    assert [e.prev_hash for e in entries[1:]] == [e.hash for e in entries[:-1]]
    assert system.record["actor"] == "SearchTrail" and system.record["actor_email"] is None
    assert entries[0].record["version"] == 1 and entries[0].record["counts"] == {"items": 0}

    # The same records, written as the CLI's audit.jsonl, pass `searchtrail verify-log`'s check...
    path = tmp_path / "audit.jsonl"
    path.write_text("".join(canonical({**e.record, "hash": e.hash}) + "\n" for e in entries))
    assert AuditLog(path).verify() == (True, "3 entries verified, chain intact")
    # ...and editing one breaks it.
    tampered = {**entries[1].record, "counts": {"items": 999}}
    path.write_text("".join(canonical({**r, "hash": e.hash}) + "\n"
                            for r, e in zip([entries[0].record, tampered, entries[2].record], entries, strict=True)))
    assert AuditLog(path).verify()[0] is False


def test_the_log_refuses_reserved_fields_and_unknown_matters(sessions):
    with sessions() as s:
        matter = add_matter(s)
        with pytest.raises(ValueError, match="seq"):
            repositories.append_log(s, matter.id, "estimate", actor="A", actor_email=None, summary="", seq=7)
        with pytest.raises(ValueError):
            repositories.append_log(s, matter.id, "not_an_action", actor="A", actor_email=None, summary="")
        with pytest.raises(LookupError):
            repositories.append_log(s, "mat_nope", "estimate", actor="A", actor_email=None, summary="")


@pytest.mark.postgres
def test_concurrent_appends_to_one_matter_are_serialised(pg_sessions):
    with pg_sessions() as s:
        matter_id = add_matter(s).id
        s.commit()
    failures = []

    def append_many(name: str) -> None:
        try:
            for n in range(15):
                with pg_sessions() as s:
                    repositories.append_log(s, matter_id, "estimate", actor=name, actor_email=None, summary=str(n))
                    s.commit()
        except Exception as exc:  # noqa: BLE001 - reported below
            failures.append(exc)

    threads = [threading.Thread(target=append_many, args=(f"worker {i}",)) for i in range(3)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert failures == []
    with pg_sessions() as s:
        entries = s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == matter_id)
                            .order_by(AuditEntryRow.seq)).all()
    assert [e.seq for e in entries] == list(range(1, 46))
    assert [e.prev_hash for e in entries[1:]] == [e.hash for e in entries[:-1]]


# -- users -----------------------------------------------------------------------------------------
DANA = {"entra_object_id": "obj-dana", "tenant_id": "t", "email": "dana@contoso.com", "display_name": "Dana"}


def test_ensure_user_creates_once_and_keeps_details_current(sessions):
    with sessions() as s:
        user, changed = repositories.ensure_user(s, **DANA, id="usr_dana")
        assert (user.id, changed) == ("usr_dana", True)
        s.commit()
        assert repositories.ensure_user(s, **DANA) == (user, False)
        renamed, changed = repositories.ensure_user(s, **{**DANA, "display_name": "Dana Whitfield"})
        assert renamed is user and changed and user.display_name == "Dana Whitfield"


def test_ensure_user_reports_a_clash_it_cannot_resolve(sessions):
    with sessions() as s:
        repositories.ensure_user(s, **DANA, id="usr_dana")
        s.commit()
        with pytest.raises(IntegrityError):  # same fixed ID, different person: not silently someone else
            repositories.ensure_user(s, **{**DANA, "entra_object_id": "obj-other"}, id="usr_dana")


@pytest.mark.postgres
def test_ensure_user_loses_a_race_without_losing_the_callers_work(pg_sessions, wait_until_blocked_on_a_lock):
    first = pg_sessions()
    first.add(UserRow(id="usr_first", **DANA))
    first.flush()  # holds the unique key, not committed yet
    outcome = {}

    def second_sign_in() -> None:
        try:
            with pg_sessions() as s:
                s.add(MatterRow(id="mat_kept", matter_number="M-1", name="Kept", type="investigation"))
                s.flush()  # earlier work in the same transaction
                user, changed = repositories.ensure_user(s, **DANA)  # its insert waits for `first`, then clashes
                s.commit()
                outcome.update(user=user.id, changed=changed)
        except Exception as exc:  # noqa: BLE001 - reported below
            outcome["error"] = exc

    thread = threading.Thread(target=second_sign_in)
    thread.start()
    wait_until_blocked_on_a_lock(pg_sessions)
    first.commit()
    first.close()
    thread.join(10)
    assert outcome == {"user": "usr_first", "changed": False}
    with pg_sessions() as s:
        assert s.get(MatterRow, "mat_kept") is not None
        assert s.scalars(select(UserRow.id)).all() == ["usr_first"]


# -- datetimes -------------------------------------------------------------------------------------
def test_datetimes_load_timezone_aware_on_sqlite_too(sessions):
    with sessions() as s:
        matter_id = add_matter(s).id
        s.commit()
    with sessions() as s:
        assert s.get(MatterRow, matter_id).created_at.tzinfo is not None


# -- sources fingerprint ---------------------------------------------------------------------------
def test_the_sources_fingerprint_follows_who_and_where_is_searched(sessions):
    with sessions() as s:
        matter = add_matter(s)
        empty = repositories.sources_fingerprint(s, matter.id)
        alex = CustodianRow(id=new_id("cus"), matter_id=matter.id, user_object_id="a", display_name="Alex",
                            email="Alex.Wilber@contoso.com", sites=["https://s/2", "https://s/1"])
        s.add(alex)
        s.flush()
        with_alex = repositories.sources_fingerprint(s, matter.id)
        assert with_alex != empty

        alex.onedrive = False
        s.flush()
        assert repositories.sources_fingerprint(s, matter.id) not in (empty, with_alex)
        alex.onedrive = True
        alex.email, alex.sites = "alex.wilber@contoso.com", ["https://s/1", "https://s/2"]  # case and order don't matter
        s.flush()
        assert repositories.sources_fingerprint(s, matter.id) == with_alex

        s.add(SiteRow(id=new_id("site"), matter_id=matter.id, url="https://s/finance"))
        s.flush()
        assert repositories.sources_fingerprint(s, matter.id) != with_alex
