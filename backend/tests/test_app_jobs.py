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


def _aware(dt):
    """SQLite hands back naive datetimes; the app stores UTC."""
    from datetime import UTC

    return dt if dt.tzinfo else dt.replace(tzinfo=UTC)


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


def test_heartbeat_keeps_a_slow_job_alive(sessions, handlers, monkeypatch):
    import time

    from app.jobs import worker as worker_module

    monkeypatch.setattr(worker_module, "HEARTBEAT_SECONDS", 0.05)
    seen: list = []

    def slow(ctx):
        # A handler blocked on one long call (a download, say) never calls ctx.heartbeat itself.
        started = utcnow()
        time.sleep(0.4)
        with sessions() as s:
            seen.append((started, s.get(JobRow, ctx.job.id).heartbeat_at))
        return {}

    handlers["download"] = slow
    with sessions() as s:
        job_id = queue.enqueue(s, "download").id
        s.commit()
    beats: list = []
    with sessions() as s:
        run_one(s, "w1", gw, sessions=sessions, beat=lambda: beats.append(1))
    started, heartbeat_at = seen[0]
    assert _aware(heartbeat_at) > started  # the background thread touched the row while the handler slept
    assert beats  # and the liveness beat ran too
    with sessions() as s:
        assert s.get(JobRow, job_id).status == "succeeded"


def test_default_heartbeat_is_well_under_the_stale_threshold():
    from app.jobs.worker import HEARTBEAT_SECONDS

    assert HEARTBEAT_SECONDS * 4 <= queue.STALE_AFTER.total_seconds()


def test_loop_requeues_stale_jobs_then_runs_them(sessions, handlers, tmp_path):
    handlers["estimate"] = lambda _ctx: {"ok": True}
    with sessions() as s:
        job = queue.enqueue(s, "estimate")
        s.commit()
        claimed = queue.claim_next(s, "dead-worker")
        claimed.heartbeat_at = utcnow() - timedelta(minutes=10)
        s.commit()
    w = Worker(AppSettings(dry_run=True), sessions=sessions, gateway_for=gw)
    w.loop(once=True)
    with sessions() as s:
        done = s.get(JobRow, job.id)
        assert done.status == "succeeded" and done.attempts == 2
