"""The jobs table and worker loop."""
from datetime import timedelta
from threading import Barrier, Thread

import pytest

from app.db.base import utcnow
from app.db.models import JobRow
from app.jobs import queue
from app.jobs.handlers import HANDLERS, JobFailed
from app.jobs.worker import Worker, run_one
from app.settings import AppSettings
from searchtrail.gateway_dryrun import DryRunPurviewGateway


@pytest.fixture
def handlers():
    saved = dict(HANDLERS)
    yield HANDLERS
    HANDLERS.clear()
    HANDLERS.update(saved)


def gw(_job=None):
    return DryRunPurviewGateway(log=lambda _m: None)


def test_enqueue_rejects_unknown_kinds(sessions):
    with sessions() as s, pytest.raises(ValueError, match="Unknown job kind"):
        queue.enqueue(s, "launch_rockets")


def test_worker_runs_a_job_through_the_gateway(sessions, handlers):
    def estimate(ctx):
        case = ctx.gateway.ensure_case("M-1 test", "t")
        search = ctx.gateway.create_search(case["id"], "s", "kickback", [])
        url = ctx.gateway.start_estimate(case["id"], search["id"])
        ctx.heartbeat(progress=0.5, checkpoint={"operation_url": url})
        return {"items": ctx.gateway.get_operation(url)["indexedItemCount"]}

    handlers["estimate"] = estimate
    with sessions() as s:
        job_id = queue.enqueue(s, "estimate", payload={"x": 1}).id
        s.commit()
    with sessions() as s:
        assert run_one(s, "w1", gw) is True
        assert run_one(s, "w1", gw) is False  # queue empty
    with sessions() as s:
        job = s.get(JobRow, job_id)
        assert job.status == "succeeded" and job.progress == 1.0 and job.result["items"] > 0
        assert "/operations/" in job.checkpoint["operation_url"] and job.attempts == 1


def test_failures_are_recorded_with_contract_error_codes(sessions, handlers):
    def throttled(_ctx):
        raise JobFailed("graph_throttled", "Microsoft is limiting requests right now.", {"retry_after_seconds": 60})

    def crash(_ctx):
        raise KeyError("boom")

    handlers["preview"] = throttled
    handlers["export"] = crash
    with sessions() as s:
        ids = [queue.enqueue(s, k).id for k in ("preview", "export", "download")]
        s.commit()
    with sessions() as s:
        while run_one(s, "w1", gw):
            pass
    with sessions() as s:
        errors = [s.get(JobRow, i).error for i in ids]
    assert [e["code"] for e in errors] == ["graph_throttled", "internal_error", "internal_error"]
    assert errors[0]["details"] == {"retry_after_seconds": 60}
    assert "can't run 'download' jobs yet" in errors[2]["message"]


def test_stale_running_jobs_are_requeued_with_their_checkpoint(sessions):
    with sessions() as s:
        job = queue.enqueue(s, "export")
        s.commit()
        claimed = queue.claim_next(s, "dead-worker")
        claimed.checkpoint = {"operation_url": "https://graph/op/1"}
        claimed.heartbeat_at = utcnow() - timedelta(minutes=10)
        s.commit()
        assert queue.requeue_stale(s) == 1
        again = queue.claim_next(s, "new-worker")
        assert again.id == job.id and again.attempts == 2
        assert again.checkpoint == {"operation_url": "https://graph/op/1"}


def test_jobs_scheduled_for_later_wait(sessions):
    with sessions() as s:
        queue.enqueue(s, "estimate", run_after=utcnow() + timedelta(hours=1))
        s.commit()
        assert queue.claim_next(s, "w1") is None


def test_worker_loop_once_writes_a_heartbeat(sessions, tmp_path):
    beat = tmp_path / "beat"
    w = Worker(AppSettings(dry_run=True, worker_heartbeat_file=beat), sessions=sessions, gateway_for=gw)
    w.loop(once=True)
    assert float(beat.read_text()) > 0


@pytest.mark.postgres
def test_two_workers_never_claim_the_same_job(pg_sessions):
    with pg_sessions() as s:
        for _ in range(2):
            queue.enqueue(s, "estimate")
        s.commit()
    start, claimed = Barrier(2), []

    def claim(name):
        with pg_sessions() as s:
            start.wait()
            job = queue.claim_next(s, name)
            claimed.append(job.id if job else None)

    threads = [Thread(target=claim, args=(f"w{i}",)) for i in range(2)]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    assert None not in claimed and len(set(claimed)) == 2
