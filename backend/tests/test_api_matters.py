"""Matters endpoints (listMatters, createMatter, getMatter, updateMatter) against the contract."""
from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.api.deps import DRY_RUN_USER
from app.db import repositories
from app.db.base import new_id
from app.db.models import (
    AuditEntryRow,
    CriteriaDraftRow,
    CustodianRow,
    ExportRow,
    HoldRow,
    MatterRow,
    QueryVersionRow,
    RunRow,
    SiteRow,
    UserRow,
)
from app.db.session import get_session
from app.main import create_app
from app.schemas.contract import Error, Matter, MatterList
from app.settings import AppSettings
from searchtrail.audit import GENESIS, canonical, sha256_text

FALCON = {"matter_number": "M-2026-0142", "name": "Project Falcon investigation", "type": "investigation",
          "description": "Internal investigation into supplier payments linked to Project Falcon."}
T0 = datetime(2026, 11, 1, 9, 0, tzinfo=UTC)


def make_client(sessions, *, dry_run: bool = True) -> TestClient:
    app = create_app(AppSettings(cors_origins=[], dry_run=dry_run))

    def session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = session
    return TestClient(app)


@pytest.fixture
def api(sessions):
    return make_client(sessions)


def assert_error(response, status: int, code: str) -> Error:
    assert response.status_code == status, response.text
    error = Error.model_validate(response.json())
    assert error.code.value == code
    return error


def create(api, **overrides) -> Matter:
    r = api.post("/api/v1/matters", json={**FALCON, **overrides})
    assert r.status_code == 201, r.text
    return Matter.model_validate(r.json())


# -- create ----------------------------------------------------------------------------------------
def test_create_returns_the_matter_and_logs_it(api, sessions):
    matter = create(api)
    assert matter.matter_number == "M-2026-0142" and matter.stage.value == "scoping"
    assert matter.created_by.id == "usr_dana" and matter.created_by.display_name == "Dana Whitfield"
    assert matter.custodians == [] and matter.sites == [] and matter.purview_case_id is None
    assert matter.current_version is None and matter.previewed_version is None and matter.draft_changed is False

    with sessions() as s:
        [entry] = s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == matter.id)).all()
    assert entry.seq == 1 and entry.action == "matter_created" and entry.prev_hash == GENESIS
    assert entry.record["actor"] == "Dana Whitfield" and entry.record["actor_email"] == "dana.whitfield@contoso.com"
    assert entry.record["matter"]["name"] == FALCON["name"]
    assert entry.hash == sha256_text(canonical(entry.record))


def test_matter_numbers_are_unique_ignoring_case(api):
    create(api)
    error = assert_error(api.post("/api/v1/matters", json={**FALCON, "matter_number": "m-2026-0142"}), 409, "conflict")
    assert error.details == {"matter_number": "m-2026-0142"}


@pytest.mark.parametrize("body", [
    {**FALCON, "matter_number": "has spaces"},
    {**FALCON, "name": ""},
    {**FALCON, "type": "audit"},
    {**FALCON, "stage": "exported"},  # unknown fields are refused
])
def test_create_rejects_invalid_input(api, body):
    assert_error(api.post("/api/v1/matters", json=body), 400, "validation_failed")


@pytest.mark.postgres
def test_a_create_that_loses_a_race_is_a_conflict_not_a_crash(pg_sessions, wait_until_blocked_on_a_lock):
    import threading

    api = make_client(pg_sessions)
    api.get("/api/v1/matters")  # create the dry-run user first
    first = pg_sessions()
    first.add(MatterRow(id="mat_first", matter_number="M-2026-0142", name="First", type="investigation",
                        created_by="usr_dana"))
    first.flush()  # holds the matter number, not committed yet
    responses = []
    thread = threading.Thread(target=lambda: responses.append(
        api.post("/api/v1/matters", json={**FALCON, "matter_number": "m-2026-0142"})))  # passes the pre-check
    thread.start()
    wait_until_blocked_on_a_lock(pg_sessions)  # its insert waits on the case-insensitive unique index
    first.commit()
    first.close()
    thread.join(10)
    assert_error(responses[0], 409, "conflict")


def test_the_dry_run_user_is_created_once(api, sessions):
    api.get("/api/v1/matters")
    api.get("/api/v1/matters")
    with sessions() as s:
        users = s.scalars(select(UserRow)).all()
    assert [(u.id, u.email) for u in users] == [("usr_dana", DRY_RUN_USER["email"])]


def test_without_dry_run_there_is_no_way_to_sign_in_yet(sessions):
    api = make_client(sessions, dry_run=False)
    assert_error(api.get("/api/v1/matters"), 401, "session_expired")


# -- list ------------------------------------------------------------------------------------------
def set_activity(sessions, matter_id: str, ts: datetime) -> None:
    with sessions() as s:
        for entry in s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == matter_id)):
            entry.ts = ts
        s.commit()


def test_list_is_most_recent_activity_first_and_filters(api, sessions):
    falcon = create(api)
    harlow = create(api, matter_number="M-2026-0137", name="Harlow v. Contoso (employment)", type="litigation")
    set_activity(sessions, falcon.id, T0 + timedelta(hours=2))
    set_activity(sessions, harlow.id, T0 + timedelta(hours=1))

    page = MatterList.model_validate(api.get("/api/v1/matters").json())
    assert [m.id for m in page.items] == [falcon.id, harlow.id] and page.total == 2
    assert page.items[0].last_activity_at == T0 + timedelta(hours=2)
    assert page.items[0].owner.display_name == "Dana Whitfield"

    def ids(**params):
        return [m["id"] for m in api.get("/api/v1/matters", params=params).json()["items"]]

    assert ids(q="harlow") == [harlow.id]          # name, ignoring case
    assert ids(q="0142") == [falcon.id]            # matter number
    assert ids(q="%") == [] and ids(q="_") == []   # LIKE wildcards are literal
    assert ids(stage="scoping") == [falcon.id, harlow.id]
    assert ids(stage="previewed") == []
    assert_error(api.get("/api/v1/matters", params={"stage": "done"}), 400, "validation_failed")


def seed_version(s, matter: MatterRow, version: int, **extra) -> QueryVersionRow:
    row = QueryVersionRow(id=new_id("qv"), matter_id=matter.id, version=version, criteria=extra.pop("criteria", {}),
                          kql="kql", kql_sha256="0" * 64, methodology=[],
                          sources_fingerprint=extra.pop("sources_fingerprint", "f" * 64), **extra)
    s.add(row)
    s.flush()
    return row


def seed_run(s, version: QueryVersionRow, kind: str, status: str, finished: datetime, items: int | None) -> RunRow:
    counts = None if items is None else {"items": items, "size_bytes": 1, "partial_items": items // 10,
                                         "partial_size_bytes": 1, "mailboxes": 1, "sites": 0}
    run = RunRow(id=new_id("run"), matter_id=version.matter_id, query_version_id=version.id, kind=kind,
                 status=status, counts=counts, files=[], finished_at=finished)
    s.add(run)
    s.flush()
    return run


def test_list_shows_custodians_latest_counts_and_export_progress(api, sessions):
    falcon, q3, harlow = (create(api, matter_number=n, name=n) for n in ("M-1", "M-2", "M-3"))
    with sessions() as s:
        m = s.get(MatterRow, falcon.id)
        v1, v2 = seed_version(s, m, 1), seed_version(s, m, 2)
        m.current_version, m.stage = 2, "previewed"
        seed_run(s, v1, "preview", "succeeded", T0, 900)                         # older version: ignored
        seed_run(s, v2, "estimate", "succeeded", T0 + timedelta(minutes=5), 600)
        seed_run(s, v2, "preview", "succeeded", T0 + timedelta(minutes=9), 630)  # latest: shown
        seed_run(s, v2, "preview", "failed", T0 + timedelta(minutes=12), None)
        for i in range(2):
            s.add(CustodianRow(id=new_id("cus"), matter_id=m.id, user_object_id=f"u{i}", display_name=f"P {i}",
                               email=f"p{i}@contoso.com"))

        q = s.get(MatterRow, q3.id)
        qv = seed_version(s, q, 1)
        q.current_version, q.stage = 1, "exporting"
        for progress, started in ((1.0, T0), (0.64, T0 + timedelta(hours=1))):
            s.add(ExportRow(id=new_id("exp"), matter_id=q.id, query_version_id=qv.id, name="E", options={}, counts={},
                            status="ready" if progress == 1.0 else "preparing", progress=progress, started_at=started))

        h = s.get(MatterRow, harlow.id)
        seed_version(s, h, 1)
        h.current_version = 1  # estimated, but no run has finished yet
        s.commit()

    by_id = {m.id: m for m in MatterList.model_validate(api.get("/api/v1/matters").json()).items}
    assert by_id[falcon.id].custodian_count == 2
    assert by_id[falcon.id].latest_counts.model_dump() == {"items": 630, "partial_items": 63}
    assert by_id[falcon.id].export_progress is None
    assert by_id[q3.id].export_progress == 0.64 and by_id[q3.id].stage.value == "exporting"
    assert by_id[harlow.id].current_version == 1 and by_id[harlow.id].latest_counts is None


# -- details ---------------------------------------------------------------------------------------
def test_get_returns_custodians_holds_sites_and_preview_state(api, sessions):
    created = create(api)
    with sessions() as s:
        m = s.get(MatterRow, created.id)
        alex = CustodianRow(id=new_id("cus"), matter_id=m.id, user_object_id="obj-alex", display_name="Alex Wilber",
                            email="alex.wilber@contoso.com", department="Procurement", created_at=T0)
        megan = CustodianRow(id=new_id("cus"), matter_id=m.id, user_object_id="obj-megan", display_name="Megan Bowen",
                             email="megan.bowen@contoso.com", department="Finance", created_at=T0 + timedelta(seconds=1),
                             sites=["https://contoso.sharepoint.com/sites/ProjectFalcon"])
        s.add_all([alex, megan, SiteRow(id="site_finance", matter_id=m.id, url="https://contoso.sharepoint.com/sites/Finance")])
        s.flush()
        s.add_all([
            HoldRow(id=new_id("hold"), custodian_id=megan.id, status="pending", requested_at=T0),
            HoldRow(id=new_id("hold"), custodian_id=megan.id, status="on", requested_at=T0 + timedelta(minutes=1),
                    since=T0 + timedelta(minutes=8)),
        ])
        s.flush()
        criteria = {"keywords": ["falcon"]}
        version = seed_version(s, m, 3, criteria=criteria,
                               sources_fingerprint=repositories.sources_fingerprint(s, m.id))
        m.current_version = 3
        s.add(CriteriaDraftRow(matter_id=m.id, criteria=criteria, based_on_version=3))
        seed_run(s, version, "preview", "succeeded", T0 + timedelta(hours=1), 630)
        s.commit()

    matter = Matter.model_validate(api.get(f"/api/v1/matters/{created.id}").json())
    alex_out, megan_out = matter.custodians
    assert (alex_out.user_id, alex_out.initials, alex_out.hold.status.value) == ("obj-alex", "AW", "off")
    assert megan_out.hold.status.value == "on" and megan_out.hold.since == T0 + timedelta(minutes=8)
    assert [str(u) for u in megan_out.sites] == ["https://contoso.sharepoint.com/sites/ProjectFalcon"]
    assert [(site.id, str(site.url)) for site in matter.sites] == [("site_finance", "https://contoso.sharepoint.com/sites/Finance")]
    assert (matter.current_version, matter.previewed_version) == (3, 3)
    assert matter.last_previewed_at == T0 + timedelta(hours=1)
    assert matter.draft_changed is False

    with sessions() as s:  # turning a source off makes the version stale
        s.scalars(select(CustodianRow).where(CustodianRow.user_object_id == "obj-alex")).one().onedrive = False
        s.commit()
    assert api.get(f"/api/v1/matters/{created.id}").json()["draft_changed"] is True

    with sessions() as s:  # and so does editing the criteria
        s.scalars(select(CustodianRow).where(CustodianRow.user_object_id == "obj-alex")).one().onedrive = True
        s.get(CriteriaDraftRow, created.id).criteria = {"keywords": ["falcon", "kickback"]}
        s.commit()
    assert api.get(f"/api/v1/matters/{created.id}").json()["draft_changed"] is True


def test_get_unknown_matter_is_not_found(api):
    error = assert_error(api.get("/api/v1/matters/mat_nope"), 404, "not_found")
    assert error.details == {"matter_id": "mat_nope"}


# -- edit ------------------------------------------------------------------------------------------
def log_actions(sessions, matter_id: str) -> list[str]:
    with sessions() as s:
        return list(s.scalars(select(AuditEntryRow.action).where(AuditEntryRow.matter_id == matter_id)
                              .order_by(AuditEntryRow.seq)))


def test_update_changes_the_details_and_logs_what_changed(api, sessions):
    created = create(api)
    r = api.patch(f"/api/v1/matters/{created.id}", json={"description": "Supplier payments (Project Falcon).",
                                                         "type": "regulatory"})
    assert r.status_code == 200, r.text
    matter = Matter.model_validate(r.json())
    assert matter.description == "Supplier payments (Project Falcon)." and matter.type.value == "regulatory"
    assert matter.name == FALCON["name"]  # untouched

    with sessions() as s:
        entry = s.scalars(select(AuditEntryRow).where(AuditEntryRow.matter_id == created.id, AuditEntryRow.seq == 2)).one()
    assert entry.action == "matter_updated"
    assert entry.record["changes"] == {"type": {"from": "investigation", "to": "regulatory"},
                                       "description": {"from": FALCON["description"],
                                                       "to": "Supplier payments (Project Falcon)."}}
    assert entry.record["summary"] == "Changed the type and description"

    assert api.patch(f"/api/v1/matters/{created.id}", json={"type": "regulatory"}).status_code == 200
    assert log_actions(sessions, created.id) == ["matter_created", "matter_updated"]  # nothing changed, nothing logged


def test_update_refuses_the_matter_number_nulls_and_unknown_matters(api, sessions):
    created = create(api)
    assert_error(api.patch(f"/api/v1/matters/{created.id}", json={"matter_number": "M-9"}), 400, "validation_failed")
    error = assert_error(api.patch(f"/api/v1/matters/{created.id}", json={"description": None}), 400,
                         "validation_failed")
    assert [e["loc"] for e in error.details["errors"]] == [["body", "description"]]
    assert log_actions(sessions, created.id) == ["matter_created"]
    cleared = api.patch(f"/api/v1/matters/{created.id}", json={"description": ""})  # "" clears it
    assert cleared.status_code == 200 and cleared.json()["description"] == ""
    assert_error(api.patch("/api/v1/matters/mat_nope", json={"name": "X"}), 404, "not_found")
