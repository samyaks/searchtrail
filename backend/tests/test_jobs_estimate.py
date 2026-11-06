"""The estimate job: Purview sync, counts, the log, and resuming after a worker dies."""
from __future__ import annotations

from datetime import timedelta

import pytest
from jobs_helpers import (
    KQL_V1,
    KQL_V2,
    add_version,
    calls,
    custodian,
    enqueue_estimate,
    job,
    run_all,
    seed_matter,
    tenant,
)
from sqlalchemy import select

from app.db.base import utcnow
from app.db.models import AuditEntryRow, JobRow, MatterRow, QueryVersionRow, RunRow
from app.jobs import queue, steps
from app.jobs.worker import run_one
from app.schemas.contract import EstimateResult


@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    waits: list[float] = []
    monkeypatch.setattr(steps, "sleep", waits.append)
    return waits


def test_an_estimate_syncs_purview_counts_and_logs(sessions):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        version = add_version(s, matter)
        matter_id, version_id = matter.id, version.id
        job_id = enqueue_estimate(s, version)
    run_all(sessions, gw)

    done = job(sessions, job_id)
    assert done.status == "succeeded", done.error
    result = EstimateResult.model_validate(done.result)
    assert result.version == 1 and result.counts.items > 0 and result.counts.mailboxes >= 1

    with sessions() as s:
        [run] = s.scalars(select(RunRow)).all()
        assert (run.kind, run.status, run.query_version_id) == ("estimate", "succeeded", version_id)
        assert run.counts == result.counts.model_dump(mode="json")
        matter, version = s.get(MatterRow, matter_id), s.get(QueryVersionRow, version_id)
        state = matter.purview_state
        assert matter.purview_case_id == state["case_id"]
        assert version.purview_search_id == state["search"]["id"] and state["search"]["kql"] == KQL_V1
        alex, megan = custodian(s, "alex.wilber@contoso.com"), custodian(s, "megan.bowen@contoso.com")
        assert alex.purview_custodian_id and alex.purview_user_source_id
        assert state["custodians"]["alex.wilber@contoso.com"]["included_sources"] == "mailbox"  # OneDrive off
        assert list(state["custodians"]["megan.bowen@contoso.com"]["sites"]) == [
            "https://contoso.sharepoint.com/sites/ProjectFalcon"]
        assert megan.purview_user_source_id
        [entry] = s.scalars(select(AuditEntryRow).where(AuditEntryRow.action == "estimate")).all()
    assert entry.record["actor"] == "Dana Whitfield" and entry.record["version"] == 1
    assert entry.record["summary"] == f"Query v1 · {result.counts.items:,} items + {result.counts.partial_items:,} partially indexed"
    assert entry.record["kql"] == KQL_V1 and entry.record["counts"] == run.counts

    # Purview got exactly what the matter describes, once.
    assert len(calls(gw, "POST", "/ediscoveryCases")) == 1
    assert [c[2]["includedSources"] for c in calls(gw, "POST", "/userSources")] == ["mailbox", "mailbox, site"]
    assert len(calls(gw, "POST", "/siteSources")) == 1 and len(calls(gw, "POST", "/additionalSources")) == 1
    assert len(calls(gw, "POST", "/searches")) == 1 and len(calls(gw, "POST", "/estimateStatistics")) == 1


def test_a_new_version_reuses_the_search_and_new_sources_get_a_new_one(sessions):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        matter_id = matter.id
        enqueue_estimate(s, add_version(s, matter, KQL_V1))
    run_all(sessions, gw)

    with sessions() as s:  # v2: same people and sites, one more term
        enqueue_estimate(s, add_version(s, s.get(MatterRow, matter_id), KQL_V2))
    run_all(sessions, gw)
    assert len(calls(gw, "POST", "/searches")) == 1 and len(calls(gw, "POST", "/ediscoveryCases")) == 1
    assert [c[2]["contentQuery"] for c in calls(gw, "PATCH", "")] == [KQL_V2]

    with sessions() as s:  # v3: Alex's OneDrive is now searched too
        custodian(s, "alex.wilber@contoso.com").onedrive = True
        s.flush()
        enqueue_estimate(s, add_version(s, s.get(MatterRow, matter_id), KQL_V2))
    run_all(sessions, gw)
    assert calls(gw, "POST", "/userSources")[-1][2]["includedSources"] == "mailbox, site"
    searches = calls(gw, "POST", "/searches")
    assert [c[2]["displayName"] for c in searches] == ["M-2026-0142 cull v1", "M-2026-0142 cull v2"]
    with sessions() as s:
        versions = s.scalars(select(QueryVersionRow).order_by(QueryVersionRow.version)).all()
        assert versions[0].purview_search_id == versions[1].purview_search_id != versions[2].purview_search_id
        assert len(s.scalars(select(RunRow).where(RunRow.status == "succeeded")).all()) == 3


class Killed(BaseException):
    """Stands in for the worker process dying: not an Exception, so nothing in the worker catches it."""


def test_a_job_whose_worker_died_is_finished_by_another_with_one_purview_start(sessions, monkeypatch):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        job_id = enqueue_estimate(s, add_version(s, matter))

    real_get_operation = gw.get_operation

    def die(_url):
        raise Killed

    monkeypatch.setattr(gw, "get_operation", die)  # worker 1 dies while polling
    with sessions() as s, pytest.raises(Killed):
        run_one(s, "worker-1", lambda _job: gw)
    monkeypatch.setattr(gw, "get_operation", real_get_operation)

    with sessions() as s:
        orphan = s.get(JobRow, job_id)
        assert orphan.status == "running" and orphan.locked_by == "worker-1"
        assert "/operations/" in orphan.checkpoint["operation_url"]
        orphan.heartbeat_at = utcnow() - timedelta(minutes=10)  # its heartbeat went quiet
        s.commit()
        assert queue.requeue_stale(s) == 1

    run_all(sessions, gw, worker="worker-2")
    done = job(sessions, job_id)
    assert done.status == "succeeded" and done.attempts == 2, done.error
    assert len(calls(gw, "POST", "/estimateStatistics")) == 1  # polled the same operation, never started another
    assert len(calls(gw, "POST", "/searches")) == 1
    with sessions() as s:
        [run] = s.scalars(select(RunRow)).all()
        assert run.status == "succeeded" and run.id == done.checkpoint["run_id"]
        assert len(s.scalars(select(AuditEntryRow).where(AuditEntryRow.action == "estimate")).all()) == 1


def test_progress_follows_purview_while_polling(sessions, monkeypatch, no_waiting):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        job_id = enqueue_estimate(s, add_version(s, matter))
    real_get_operation, seen = gw.get_operation, []

    def slow(url):
        seen.append(round(job(sessions, job_id).progress, 2))  # what the UI would show right now
        if len(seen) < 3:
            return {"id": "op", "status": "running", "percentProgress": 40 * len(seen)}
        return real_get_operation(url)

    monkeypatch.setattr(gw, "get_operation", slow)
    run_all(sessions, gw)
    assert seen == [0.1, 0.44, 0.78]  # 0.1 + 0.85 x 40% and 80%
    assert no_waiting == [5.0, 7.5]  # backing off between polls
    assert job(sessions, job_id).progress == 1.0


def test_a_failed_purview_operation_fails_the_job_and_the_run(sessions, monkeypatch):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        job_id = enqueue_estimate(s, add_version(s, matter))
    monkeypatch.setattr(gw, "get_operation", lambda _url: {"status": "failed", "resultInfo": {"message": "nope"}})
    run_all(sessions, gw)

    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "purview_operation_failed"
    assert failed.error["details"]["operation_status"] == "failed"
    with sessions() as s:
        [run] = s.scalars(select(RunRow)).all()
        assert run.status == "failed" and run.counts is None
        assert s.scalars(select(AuditEntryRow).where(AuditEntryRow.action == "estimate")).all() == []


def test_sources_changed_since_the_version_fail_before_touching_purview(sessions):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        version = add_version(s, matter)
        custodian(s, "alex.wilber@contoso.com").onedrive = True  # after the version froze the sources
        job_id = enqueue_estimate(s, version)
    run_all(sessions, gw)

    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "conflict"
    assert gw.transport.calls == []


def test_a_job_for_a_missing_version_says_so(sessions):
    with sessions() as s:
        matter = seed_matter(s)
        job_id = queue.enqueue(s, "estimate", matter_id=matter.id, payload={"query_version_id": "qv_gone"}).id
        s.commit()
    run_all(sessions, tenant())
    assert job(sessions, job_id).error["code"] == "not_found"


@pytest.mark.postgres
def test_estimates_work_on_postgres(pg_sessions):
    gw = tenant()
    with pg_sessions() as s:
        matter = seed_matter(s)
        job_id = enqueue_estimate(s, add_version(s, matter))
    run_all(pg_sessions, gw)
    done = job(pg_sessions, job_id)
    assert done.status == "succeeded", done.error
    with pg_sessions() as s:
        assert s.get(MatterRow, done.matter_id).purview_state["search"]["kql"] == KQL_V1
