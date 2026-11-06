"""The estimate job: Purview sync, counts, the log, and resuming after a worker dies."""
from __future__ import annotations

import threading
from datetime import timedelta

import pytest
import requests
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
from searchtrail.graph import GraphError


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


# -- a source that exists with other settings -------------------------------------------------------
def test_a_custodian_toggle_that_purview_cannot_apply_stops_instead_of_searching_the_wrong_data(sessions):
    """Live Purview returns the existing source for a custodian (the gateway can't change it yet), so
    turning OneDrive on must not be recorded as done. The dry-run tenant never returns existing sources,
    so this one is made to, the way a real case does."""
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        matter_id = matter.id
        enqueue_estimate(s, add_version(s, matter, KQL_V1))
    run_all(sessions, gw)
    with sessions() as s:
        old_state = s.get(MatterRow, matter_id).purview_state["custodians"]["alex.wilber@contoso.com"]
        assert old_state["included_sources"] == "mailbox"

    real = gw.ensure_user_source
    gw.ensure_user_source = lambda case, cust, email, flags="mailbox, site": (
        {"id": old_state["user_source_id"], "email": email, "includedSources": "mailbox"}
        if email.startswith("alex") else real(case, cust, email, flags))
    with sessions() as s:  # Alex's OneDrive is now searched too
        custodian(s, "alex.wilber@contoso.com").onedrive = True
        s.flush()
        job_id = enqueue_estimate(s, add_version(s, s.get(MatterRow, matter_id), KQL_V2))
    run_all(sessions, gw)

    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "conflict"
    assert "alex.wilber@contoso.com" in failed.error["message"] and "'mailbox'" in failed.error["message"]
    assert failed.error["details"] == {"custodian": "alex.wilber@contoso.com", "wanted": "mailbox, site", "found": "mailbox"}
    with sessions() as s:
        assert s.get(MatterRow, matter_id).purview_state["custodians"]["alex.wilber@contoso.com"] == old_state
        assert s.scalars(select(RunRow).where(RunRow.status == "running")).all() == []  # nothing left half-done


def test_the_same_source_settings_in_another_order_are_not_a_mismatch(sessions):
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        custodian(s, "alex.wilber@contoso.com").onedrive = True
        job_id = enqueue_estimate(s, add_version(s, matter))
    real = gw.ensure_user_source
    gw.ensure_user_source = lambda *a, **k: {**real(*a, **k), "includedSources": "site,mailbox"}  # wanted "mailbox, site"
    run_all(sessions, gw)
    assert job(sessions, job_id).status == "succeeded"


# -- Microsoft errors ---------------------------------------------------------------------------------
def make_due(sessions, job_id: str) -> None:
    with sessions() as s:
        s.get(JobRow, job_id).run_after = utcnow() - timedelta(seconds=1)
        s.commit()


def start_estimate_job(sessions):
    with sessions() as s:
        matter = seed_matter(s)
        return enqueue_estimate(s, add_version(s, matter))


def test_throttling_while_polling_retries_the_same_operation_later(sessions, monkeypatch):
    gw = tenant()
    job_id = start_estimate_job(sessions)
    real_get_operation = gw.get_operation

    def throttled(_url):
        raise GraphError(429, "GET", "https://graph/op", "slow down")

    monkeypatch.setattr(gw, "get_operation", throttled)
    run_all(sessions, gw)

    waiting = job(sessions, job_id)
    assert waiting.status == "queued" and waiting.error is None and waiting.attempts == 1
    assert 50 < (waiting.run_after - utcnow()).total_seconds() <= 60  # one attempt's wait
    assert "/operations/" in waiting.checkpoint["operation_url"]
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "running"  # the retry resumes this run

    monkeypatch.setattr(gw, "get_operation", real_get_operation)
    make_due(sessions, job_id)
    run_all(sessions, gw, worker="w2")
    assert job(sessions, job_id).status == "succeeded"
    assert len(calls(gw, "POST", "/estimateStatistics")) == 1  # never started a second estimate
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "succeeded"


@pytest.mark.parametrize("error,code", [
    (GraphError(429, "GET", "u", ""), "graph_throttled"),
    (GraphError(503, "GET", "u", ""), "purview_operation_failed"),
    (requests.ConnectionError("reset"), "purview_operation_failed"),
])
def test_a_job_that_keeps_being_retried_fails_with_the_cause(sessions, monkeypatch, error, code):
    monkeypatch.setattr(queue, "MAX_ATTEMPTS", 3)
    gw = tenant()
    job_id = start_estimate_job(sessions)

    def broken(_url):
        raise error

    monkeypatch.setattr(gw, "get_operation", broken)
    for _ in range(3):
        make_due(sessions, job_id)
        run_all(sessions, gw)
    failed = job(sessions, job_id)
    assert (failed.status, failed.attempts, failed.error["code"]) == ("failed", 3, code)
    assert failed.error["details"]["attempts"] == 3


def test_a_permission_error_fails_at_once_and_closes_the_run(sessions, monkeypatch):
    gw = tenant()
    job_id = start_estimate_job(sessions)
    monkeypatch.setattr(gw, "get_operation", lambda _url: (_ for _ in ()).throw(GraphError(403, "GET", "u", "Forbidden")))
    run_all(sessions, gw)
    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "purview_permission_missing"
    assert "eDiscovery Manager" in failed.error["message"] and failed.attempts == 1
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "failed"


def test_errors_while_syncing_are_mapped_too_and_leave_no_run(sessions, monkeypatch):
    gw = tenant()
    job_id = start_estimate_job(sessions)
    monkeypatch.setattr(gw, "ensure_case", lambda *a, **k: (_ for _ in ()).throw(GraphError(403, "POST", "u", "no")))
    run_all(sessions, gw)
    assert job(sessions, job_id).error["code"] == "purview_permission_missing"
    with sessions() as s:
        assert s.scalars(select(RunRow)).all() == []


# -- stopping -------------------------------------------------------------------------------------------
def test_a_stop_request_hands_the_job_back_without_waiting_out_the_poll(sessions, monkeypatch):
    gw = tenant()
    job_id = start_estimate_job(sessions)
    real_get_operation, stop = gw.get_operation, threading.Event()

    def running_then_stop(_url):
        stop.set()  # SIGTERM arrives while Purview is still working
        return {"id": "op", "status": "running", "percentProgress": 10}

    monkeypatch.setattr(gw, "get_operation", running_then_stop)
    with sessions() as s:
        assert run_one(s, "w1", lambda _job: gw, stop=stop) is True

    handed_back = job(sessions, job_id)
    assert handed_back.status == "queued" and handed_back.error is None
    assert handed_back.attempts == 0  # a stop isn't the job's fault
    assert (handed_back.run_after - utcnow()).total_seconds() < 5 and handed_back.locked_by is None
    assert "/operations/" in handed_back.checkpoint["operation_url"]

    monkeypatch.setattr(gw, "get_operation", real_get_operation)
    run_all(sessions, gw, worker="w2")
    assert job(sessions, job_id).status == "succeeded"
    assert len(calls(gw, "POST", "/estimateStatistics")) == 1


def test_the_worker_stop_flag_is_an_event(sessions):
    from app.jobs.worker import Worker
    from app.settings import AppSettings

    worker = Worker(AppSettings(dry_run=True), sessions=sessions, gateway_for=lambda _job: tenant())
    assert worker.stopping is False
    worker.stopping = True
    assert worker.stop_event.is_set() and worker.stopping is True


# -- the lock ---------------------------------------------------------------------------------------------
@pytest.mark.postgres
def test_syncing_purview_does_not_block_edits_and_log_writes_to_the_matter(pg_sessions):
    """The matter's row isn't locked while a job makes its Graph calls (B1's edits and every log append
    take that lock), but another job on the same matter would wait: an advisory lock is held."""
    from sqlalchemy import text

    from app.db import repositories

    gw = tenant()
    with pg_sessions() as s:
        matter = seed_matter(s)
        matter_id = matter.id
        job_id = enqueue_estimate(s, add_version(s, matter))
    started, release, real_ensure_case = threading.Event(), threading.Event(), gw.ensure_case

    def slow_ensure_case(*args, **kwargs):
        started.set()
        assert release.wait(20)
        return real_ensure_case(*args, **kwargs)

    gw.ensure_case = slow_ensure_case
    worker = threading.Thread(target=run_all, args=(pg_sessions, gw))
    worker.start()
    try:
        assert started.wait(20)  # the job is now mid-sync, holding its transaction open
        with pg_sessions() as s:
            s.execute(text("SET lock_timeout = '2s'"))  # blocked for 2s would raise
            repositories.append_log(s, matter_id, "matter_updated", actor="Dana Whitfield", actor_email=None,
                                    summary="Changed the name")
            s.get(MatterRow, matter_id).name = "Renamed while syncing"
            s.commit()
            assert s.scalar(text("SELECT count(*) FROM pg_locks WHERE locktype = 'advisory' AND granted")) == 1
    finally:
        release.set()
        worker.join(30)
    assert job(pg_sessions, job_id).status == "succeeded"
    with pg_sessions() as s:
        assert s.get(MatterRow, matter_id).name == "Renamed while syncing"  # the job didn't overwrite the edit
