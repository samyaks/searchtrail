"""check_export(): previewed, same sources, counts unchanged; and blocked checks never write to Purview."""
from __future__ import annotations

import pytest
from jobs_helpers import KQL_V1, KQL_V2, add_version, calls, custodian, enqueue_estimate, run_all, seed_matter, tenant, writes
from sqlalchemy import select

from app.db import repositories
from app.db.models import MatterRow, QueryVersionRow, RunRow
from app.jobs import steps
from app.jobs.export_checks import check_export
from app.schemas.contract import ExportCheck


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(steps, "sleep", lambda _s: None)


def estimated(sessions, gw, matter_id: str | None = None, kql: str | None = None) -> str:
    """Estimate a new version of the matter (seeding it first if needed); returns the matter ID."""
    with sessions() as s:
        matter = s.get(MatterRow, matter_id) if matter_id else seed_matter(s)
        enqueue_estimate(s, add_version(s, matter, kql) if kql else add_version(s, matter))
        matter_id = matter.id
    run_all(sessions, gw)
    return matter_id


def previewed(sessions, matter_id: str) -> None:
    """Stand-in for the preview job (PR 7): a finished preview of the current version, with its counts."""
    with sessions() as s:
        matter = s.get(MatterRow, matter_id)
        version = s.scalars(select(QueryVersionRow).where(QueryVersionRow.matter_id == matter_id,
                                                          QueryVersionRow.version == matter.current_version)).one()
        estimate = s.scalars(select(RunRow).where(RunRow.query_version_id == version.id, RunRow.kind == "estimate")).one()
        run = repositories.create_run(s, matter_id=matter_id, query_version_id=version.id, kind="preview", created_by=None)
        repositories.finish_run(s, run, status="succeeded", counts=estimate.counts)
        s.commit()


def check(sessions, gw, matter_id: str) -> ExportCheck:
    gw.transport.calls.clear()
    with sessions() as s:
        result = check_export(s, gw, matter_id)
        s.commit()  # as the endpoint does: a check may record the search's query in the matter's state
    return ExportCheck.model_validate(result.model_dump())


def statuses(result: ExportCheck) -> list[tuple[str, str]]:
    return [(c.key.value, c.status.value) for c in result.checks]


def test_nothing_to_export_before_any_query(sessions):
    gw = tenant()
    with sessions() as s:
        matter_id = seed_matter(s).id
        s.commit()
    result = check(sessions, gw, matter_id)
    assert not result.ready and result.blocked_code == "export_not_previewed"
    assert statuses(result) == [("previewed", "failed"), ("same_sources", "skipped"), ("counts_unchanged", "skipped")]
    assert (result.version, result.previewed_version, result.counts) == (None, None, None)
    assert gw.transport.calls == []


def test_an_estimated_but_unpreviewed_query_is_blocked_without_purview_calls(sessions):
    gw = tenant()
    matter_id = estimated(sessions, gw)
    result = check(sessions, gw, matter_id)
    assert result.blocked_code == "export_not_previewed" and result.version == 1
    assert result.checks[0].message.startswith("Query v1 hasn't been previewed")
    assert gw.transport.calls == []


def test_a_new_version_after_the_preview_must_be_previewed_again(sessions):
    gw = tenant()
    matter_id = estimated(sessions, gw)
    previewed(sessions, matter_id)
    estimated(sessions, gw, matter_id, KQL_V2)  # v2 estimated, not previewed

    result = check(sessions, gw, matter_id)
    assert result.blocked_code == "export_not_previewed"
    assert (result.version, result.previewed_version) == (2, 1)
    assert statuses(result) == [("previewed", "failed"), ("same_sources", "passed"), ("counts_unchanged", "skipped")]
    assert gw.transport.calls == []


def test_changed_sources_since_the_preview_block_the_export(sessions):
    gw = tenant()
    matter_id = estimated(sessions, gw)
    previewed(sessions, matter_id)
    with sessions() as s:
        custodian(s, "alex.wilber@contoso.com").onedrive = True
        s.commit()

    result = check(sessions, gw, matter_id)
    assert result.blocked_code == "export_not_previewed"
    assert statuses(result) == [("previewed", "passed"), ("same_sources", "failed"), ("counts_unchanged", "skipped")]
    assert "custodians or sites changed" in result.checks[1].message
    assert gw.transport.calls == []


def test_a_previewed_query_with_unchanged_counts_is_ready(sessions):
    gw = tenant()
    matter_id = estimated(sessions, gw)
    previewed(sessions, matter_id)

    result = check(sessions, gw, matter_id)
    assert result.ready and result.blocked_code is None
    assert statuses(result) == [("previewed", "passed"), ("same_sources", "passed"), ("counts_unchanged", "passed")]
    assert (result.version, result.previewed_version) == (1, 1) and result.previewed_at is not None
    with sessions() as s:
        preview = s.scalars(select(RunRow).where(RunRow.kind == "preview")).one()
    assert result.counts.model_dump(mode="json") == preview.counts
    # One estimate to re-check the counts; nothing else is written to Purview.
    assert len(calls(gw, "POST", "/estimateStatistics")) == 1 and len(writes(gw)) == 1


def test_counts_that_drifted_since_the_preview_block_the_export(sessions):
    gw = tenant()
    matter_id = estimated(sessions, gw)
    previewed(sessions, matter_id)
    gw.transport.count_offset = 17  # new mail arrived since the preview

    result = check(sessions, gw, matter_id)
    assert not result.ready and result.blocked_code == "export_counts_changed"
    assert statuses(result)[-1] == ("counts_unchanged", "failed")
    with sessions() as s:
        before = s.scalars(select(RunRow).where(RunRow.kind == "preview")).one().counts["items"]
    assert result.counts.items == before + 17
    assert f"{before:,} → {before + 17:,} items" in result.checks[2].message


def test_the_check_counts_this_versions_query_even_if_the_shared_search_holds_another(sessions):
    """Versions with the same sources share one Purview search, and a search holds one query. An older
    version estimated later leaves the search holding the older KQL; the check must not count that."""
    gw = tenant()
    matter_id = estimated(sessions, gw)                    # v1
    estimated(sessions, gw, matter_id, KQL_V2)             # v2: the current version
    previewed(sessions, matter_id)
    with sessions() as s:                                  # a v1 estimate runs again, resetting the search to v1's KQL
        v1 = s.scalars(select(QueryVersionRow).where(QueryVersionRow.version == 1)).one()
        enqueue_estimate(s, v1)
    run_all(sessions, gw)
    with sessions() as s:
        search_id = s.get(MatterRow, matter_id).purview_state["search"]["id"]
        assert s.get(MatterRow, matter_id).purview_state["search"]["kql"] == KQL_V1
    assert gw.transport._queries[search_id] == KQL_V1

    result = check(sessions, gw, matter_id)
    assert result.ready, [c.message for c in result.checks]  # counted v2's query, so nothing drifted
    patches = calls(gw, "PATCH", search_id)
    assert [p[2]["contentQuery"] for p in patches] == [KQL_V2]
    assert gw.transport.calls.index(patches[0]) < gw.transport.calls.index(
        calls(gw, "POST", "/estimateStatistics")[0])           # set before the estimate started
    with sessions() as s:
        assert s.get(MatterRow, matter_id).purview_state["search"]["kql"] == KQL_V2

    assert check(sessions, gw, matter_id).ready
    assert calls(gw, "PATCH", search_id) == []  # the search already holds the query: no second write


def test_unknown_matters_raise(sessions):
    with sessions() as s, pytest.raises(LookupError):
        check_export(s, tenant(), "mat_nope")
