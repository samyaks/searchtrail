"""What jobs do when things go wrong partway: nothing in Purview is made twice, a worker that lost its
job can't write over the one that has it now, and a database blip is passing trouble, not a failure."""
from __future__ import annotations

from datetime import timedelta

import pytest
from jobs_helpers import KQL_V1, add_version, calls, enqueue_estimate, job, run_all, seed_matter, tenant
from sqlalchemy import select
from sqlalchemy.exc import OperationalError

from app.db.base import utcnow
from app.db.models import AuditEntryRow, JobRow, MatterRow, RunRow
from app.jobs import queue
from app.jobs.worker import Worker, run_one
from app.settings import AppSettings
from searchtrail.graph import GraphError

SEARCH_V1 = "M-2026-0142 query v1"


def make_due(sessions, job_id: str) -> None:
    with sessions() as s:
        s.get(JobRow, job_id).run_after = utcnow()
        s.commit()


def run_until_settled(sessions, gw, job_id: str, rounds: int = 8) -> JobRow:
    """Run the job, making each retry due at once, until it succeeds or fails."""
    for _ in range(rounds):
        run_all(sessions, gw)
        done = job(sessions, job_id)
        if done.status in ("succeeded", "failed"):
            return done
        make_due(sessions, job_id)
    raise AssertionError(f"job still {done.status} after {rounds} rounds")


def fail_first(gw, method: str, times: int, error: Exception, *, after_real_call: bool = False):
    """Make gw.<method> raise `error` the first `times` calls. With after_real_call, the call is carried
    out first and only its answer is lost (a 504 from a gateway that gave up waiting)."""
    real, left = getattr(gw, method), [times]

    def flaky(*args, **kwargs):
        if left[0]:
            left[0] -= 1
            if after_real_call:
                real(*args, **kwargs)
            raise error
        return real(*args, **kwargs)

    setattr(gw, method, flaky)


def one_of_each(gw) -> None:
    """The matter's case, custodians, sources and search were each made once."""
    assert len(calls(gw, "POST", "/ediscoveryCases")) == 1
    assert len(calls(gw, "POST", "/custodians")) == 2 and len(calls(gw, "POST", "/userSources")) == 2
    assert len(calls(gw, "POST", "/siteSources")) == 1 and len(calls(gw, "POST", "/additionalSources")) == 1
    assert len(calls(gw, "POST", "/searches")) == 1


# -- retries create nothing twice ---------------------------------------------------------------------------
def test_throttling_after_the_sync_does_not_sync_again(sessions):
    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    fail_first(gw, "start_estimate", 2, GraphError(503, "POST", "u", "busy"))

    done = run_until_settled(sessions, gw, job_id)
    assert done.status == "succeeded" and done.attempts == 3, done.error
    one_of_each(gw)
    assert len(calls(gw, "POST", "/estimateStatistics")) == 1
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "succeeded"  # one run, resumed by each retry


def test_a_sync_stopped_partway_keeps_what_purview_made(sessions):
    """Throttled on the last step (the site without a custodian), after the case, custodians, sources and
    search were made: the IDs are saved with the failure, so the retry makes only what's still missing.
    (User and site sources can't be looked up again, so without the saved IDs they would be made twice.)"""
    gw = tenant()
    with sessions() as s:
        matter = seed_matter(s)
        matter_id = matter.id
        job_id = enqueue_estimate(s, add_version(s, matter))
    fail_first(gw, "add_additional_site", 1, GraphError(429, "POST", "u", "slow down"))

    run_all(sessions, gw)
    assert job(sessions, job_id).status == "queued"
    with sessions() as s:
        saved = s.get(MatterRow, matter_id).purview_state
        assert saved["case_id"] and len(saved["custodians"]) == 2 and saved["searches"][SEARCH_V1]["sites"] == []
        assert s.scalars(select(RunRow)).all() == []  # no run before the sync is through

    make_due(sessions, job_id)
    assert run_until_settled(sessions, gw, job_id).status == "succeeded"
    one_of_each(gw)


def test_a_search_whose_create_answer_was_lost_is_found_by_name_not_made_again(sessions):
    """Graph made the search but the answer never came back (504 from a gateway): the retry finds it."""
    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    fail_first(gw, "create_search", 1, GraphError(504, "POST", "u", "gateway timeout"), after_real_call=True)

    done = run_until_settled(sessions, gw, job_id)
    assert done.status == "succeeded", done.error
    assert len(calls(gw, "POST", "/searches")) == 1
    with sessions() as s:
        assert s.get(MatterRow, done.matter_id).purview_state["searches"][SEARCH_V1]["id"] == done.checkpoint["search_id"]


# -- a worker that lost its job -------------------------------------------------------------------------------
def test_a_worker_that_lost_its_job_cannot_finish_it_or_log_it(sessions, monkeypatch):
    """Worker 1 stalls (a paused VM) past the stale threshold; the job goes to worker 2, which finishes it.
    Then worker 1 wakes up: its result, run update and log entry must not land."""
    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    real_get_operation = gw.get_operation

    def stall_then_lose_the_job(url):
        with sessions() as s:  # meanwhile: the job is requeued and worker 2 runs it to the end
            row = s.get(JobRow, job_id)
            row.heartbeat_at = utcnow() - timedelta(minutes=10)
            s.commit()
            assert queue.requeue_stale(s) == 1
        monkeypatch.setattr(gw, "get_operation", real_get_operation)
        run_all(sessions, gw, worker="worker-2")
        return real_get_operation(url)

    monkeypatch.setattr(gw, "get_operation", stall_then_lose_the_job)
    with sessions() as s:
        assert run_one(s, "worker-1", lambda _job: gw)

    done = job(sessions, job_id)
    assert done.status == "succeeded" and done.locked_by is None and done.attempts == 2
    with sessions() as s:
        assert len(s.scalars(select(AuditEntryRow).where(AuditEntryRow.action == "estimate")).all()) == 1
        assert s.scalars(select(RunRow)).one().status == "succeeded"


def test_every_write_about_a_job_checks_the_writer_still_holds_it(sessions):
    with sessions() as s:
        queue.enqueue(s, "estimate")
        s.commit()
        job_row = queue.claim_next(s, "w1")
        with pytest.raises(queue.LostJob, match="held by w1"):
            queue.heartbeat(s, job_row, owner="w2", progress=0.5)
        for write in (lambda: queue.finish(s, job_row, {}, owner="w2"),
                      lambda: queue.fail(s, job_row, "internal_error", "x", owner="w2"),
                      lambda: queue.retry_later(s, job_row, timedelta(seconds=1), owner="w2"),
                      lambda: queue.wait(s, job_row, timedelta(seconds=1), owner="w2")):
            with pytest.raises(queue.LostJob):
                write()
        queue.touch(s, job_row.id, "w2")  # the background heartbeat just does nothing
        queue.heartbeat(s, job_row, owner="w1", progress=0.5)  # the holder still can
        assert s.get(JobRow, job_row.id).progress == 0.5


# -- the database going away -------------------------------------------------------------------------------
def test_a_database_blip_mid_job_retries_the_job_instead_of_failing_it(sessions, monkeypatch):
    from app.jobs import estimate as estimate_module

    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    real_finish_run, left = estimate_module.repositories.finish_run, [1]

    def blip(*args, **kwargs):
        if left[0]:
            left[0] -= 1
            raise OperationalError("UPDATE runs", {}, Exception("server closed the connection unexpectedly"))
        return real_finish_run(*args, **kwargs)

    monkeypatch.setattr(estimate_module.repositories, "finish_run", blip)
    run_all(sessions, gw)
    retried = job(sessions, job_id)
    assert retried.status == "queued" and retried.error is None and retried.attempts == 1

    done = run_until_settled(sessions, gw, job_id)
    assert done.status == "succeeded" and len(calls(gw, "POST", "/estimateStatistics")) == 1


def test_the_worker_loop_survives_the_database_being_down(sessions, monkeypatch):
    from app.jobs import worker as worker_module

    real_claim, left = queue.claim_next, [1]

    def down_once(session, worker_id):
        if left[0]:
            left[0] -= 1
            raise OperationalError("SELECT jobs", {}, Exception("connection refused"))
        return real_claim(session, worker_id)

    monkeypatch.setattr(worker_module.queue, "claim_next", down_once)
    monkeypatch.setattr(worker_module, "LOOP_ERROR_SECONDS", 0.01)
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    w = Worker(AppSettings(dry_run=True, worker_poll_seconds=0.01), sessions=sessions, gateway_for=lambda _j: tenant())

    def stop_when_done(*_a):
        if job(sessions, job_id).status == "succeeded":
            w.stopping = True

    monkeypatch.setattr(w, "beat", stop_when_done)
    w.loop()  # returns only once the job is done: the first failure didn't end the loop
    assert job(sessions, job_id).status == "succeeded"


# -- jobs that keep killing their worker -------------------------------------------------------------------
def test_a_job_that_keeps_stopping_its_worker_fails_instead_of_running_forever(sessions, monkeypatch):
    monkeypatch.setattr(queue, "MAX_ATTEMPTS", 3)
    with sessions() as s:
        job_id = queue.enqueue(s, "estimate").id
        s.commit()
    for attempt in range(1, 4):
        with sessions() as s:
            claimed = queue.claim_next(s, f"w{attempt}")
            assert claimed.id == job_id and claimed.attempts == attempt
            claimed.heartbeat_at = utcnow() - timedelta(minutes=10)  # ... and the worker died
            s.commit()
            requeued = queue.requeue_stale(s)
        assert requeued == (1 if attempt < 3 else 0)
    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "internal_error"
    assert failed.error["details"] == {"attempts": 3} and "3 times" in failed.error["message"]
    with sessions() as s:
        assert queue.claim_next(s, "w4") is None


def test_waiting_between_polls_never_uses_up_attempts(sessions, monkeypatch):
    monkeypatch.setattr(queue, "MAX_ATTEMPTS", 2)
    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s), KQL_V1))
    real, polls = gw.get_operation, [0]

    def slow(url):
        polls[0] += 1
        return real(url) if polls[0] > 5 else {"id": "op", "status": "running", "percentProgress": 10}

    monkeypatch.setattr(gw, "get_operation", slow)
    run_all(sessions, gw)  # five checks while Purview works, then done
    done = job(sessions, job_id)
    assert done.status == "succeeded" and done.attempts == 1 and polls[0] == 6


@pytest.mark.postgres
def test_a_worker_that_lost_its_job_cannot_finish_it_on_postgres(pg_sessions, monkeypatch):
    test_a_worker_that_lost_its_job_cannot_finish_it_or_log_it(pg_sessions, monkeypatch)
