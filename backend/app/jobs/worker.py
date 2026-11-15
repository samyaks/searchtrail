"""The worker process. Polls the jobs table and runs each job's handler.

  searchtrail-worker            run until stopped (SIGTERM or Ctrl-C)
  searchtrail-worker --once     run at most one job, then exit (tests, debugging)
"""
from __future__ import annotations

import argparse
import logging
import os
import signal
import socket
import threading
import time
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path

from sqlalchemy.exc import InterfaceError, OperationalError
from sqlalchemy.orm import Session, sessionmaker

from app.db import repositories
from app.db.models import JobRow
from app.db.session import session_factory
from app.microsoft import get_gateway
from app.settings import AppSettings, get_settings
from searchtrail.gateway import PurviewGateway

from . import queue
from .handlers import HANDLERS, JobContext, JobFailed, JobRetry, JobWait
from .queue import LostJob

log = logging.getLogger("searchtrail.worker")


GatewayFactory = Callable[[JobRow], PurviewGateway]
# How often the worker proves a running job is alive. Must be well under queue.STALE_AFTER.
HEARTBEAT_SECONDS = 30.0
# How often a worker looks for jobs left `running` by a worker that died.
REQUEUE_SECONDS = 60.0
# The database went away for a moment (a restart, a network blip): the job is retried after this long,
# and the loop pauses this long before trying again.
DATABASE_ERRORS = (OperationalError, InterfaceError)
DATABASE_RETRY_SECONDS = 30.0
LOOP_ERROR_SECONDS = 5.0


class Heartbeat(threading.Thread):
    """Keeps a running job's heartbeat_at fresh (and the liveness file, if any) in its own session,
    so a handler blocked for an hour on one Purview call is never mistaken for a dead worker."""

    def __init__(self, sessions: sessionmaker[Session], job_id: str, owner: str, beat: Callable[[], None],
                 interval: float | None = None):
        super().__init__(name=f"heartbeat-{job_id}", daemon=True)
        self.sessions, self.job_id, self.owner, self.beat = sessions, job_id, owner, beat
        self.interval = HEARTBEAT_SECONDS if interval is None else interval
        self._stopping = threading.Event()  # not `_stop`: Thread has a private method by that name

    def run(self) -> None:
        while not self._stopping.wait(self.interval):
            self.beat()
            try:
                with self.sessions() as session:
                    queue.touch(session, self.job_id, self.owner)
            except Exception:  # noqa: BLE001 - a failed heartbeat must not kill the job
                log.exception("heartbeat for job %s failed", self.job_id)

    def stop(self) -> None:
        self._stopping.set()
        self.join(timeout=5)


def run_one(session: Session, worker_id: str, gateway_for: GatewayFactory, *,
            sessions: sessionmaker[Session] | None = None, beat: Callable[[], None] = lambda: None,
            stop: threading.Event | None = None) -> bool:
    """Claim and run one job. Returns False when there was nothing to do.

    `sessions` (a session factory) turns on the background heartbeat while the handler runs. `stop` is
    the worker's stop request, passed to the handler so a long call can end early."""
    job = queue.claim_next(session, worker_id)
    if job is None:
        return False
    log.info("job %s (%s) started, attempt %d", job.id, job.kind, job.attempts)
    heartbeat = Heartbeat(sessions, job.id, worker_id, beat) if sessions else None
    if heartbeat:
        heartbeat.start()
    try:
        _run(session, job, worker_id, gateway_for, stop)
    finally:
        if heartbeat:
            heartbeat.stop()
    return True


def _run(session: Session, job: JobRow, owner: str, gateway_for: GatewayFactory, stop: threading.Event | None) -> None:
    """Run the job's handler, then record the outcome. Recording goes through the queue's ownership check
    (LostJob), and reads the job only inside `record`, because after a rollback that reads the database."""
    job_id = job.id

    def retry(after: float, code: str, message: str, details: dict) -> Callable[[], None]:
        def record() -> None:
            if job.attempts >= queue.MAX_ATTEMPTS:
                queue.fail(session, job, code, message, {**details, "attempts": job.attempts}, owner=owner)
                log.warning("job %s gave up after %d attempts: %s", job_id, job.attempts, message)
            else:
                queue.retry_later(session, job, timedelta(seconds=after), owner=owner)
                log.info("job %s will run again in %.0fs: %s", job_id, after, message)
        return record

    def fail(code: str, message: str, details: dict | None = None) -> Callable[[], None]:
        return lambda: queue.fail(session, job, code, message, details, owner=owner)

    try:
        handler = HANDLERS.get(job.kind)
        if handler is None:
            raise JobFailed("internal_error", f"This version of SearchTrail can't run '{job.kind}' jobs yet.")
        # Built per job: the live gateway acts as the user who started the job.
        result = handler(JobContext(session, job, gateway_for(job), owner, stop))

        def record() -> None:  # the handler's writes commit with the result, or not at all
            queue.finish(session, job, result, owner=owner)
            log.info("job %s succeeded", job_id)
    except LostJob as exc:
        session.rollback()
        log.warning("job %s: %s This worker's work on it is dropped.", job_id, exc)
        return
    except JobWait as exc:
        session.rollback()
        after = exc.after_seconds

        def record() -> None:
            queue.wait(session, job, timedelta(seconds=after), owner=owner)
    except JobRetry as exc:
        session.rollback()
        record = retry(exc.after_seconds, exc.code, exc.message, exc.details)
    except JobFailed as exc:
        session.rollback()
        record = fail(exc.code, exc.message, exc.details)
        log.warning("job %s failed: %s", job_id, exc.message)
    except DATABASE_ERRORS as exc:
        session.rollback()
        log.warning("job %s lost its database connection (%s); it will be retried", job_id, type(exc).__name__)
        record = retry(DATABASE_RETRY_SECONDS, "internal_error",
                       "SearchTrail kept losing its connection to its database while running this job.",
                       {"type": type(exc).__name__})
    except Exception as exc:  # noqa: BLE001 - a bad job must not stop the worker
        session.rollback()
        log.exception("job %s crashed", job_id)
        record = fail("internal_error", "Something went wrong running this job. It has been logged.",
                      {"type": type(exc).__name__})

    try:
        record()
    except LostJob as exc:
        log.warning("job %s: %s Its outcome here is dropped.", job_id, exc)
    except DATABASE_ERRORS:
        session.rollback()
        log.exception("job %s: couldn't record its outcome. It stays running until its heartbeat is stale, "
                      "then runs again from its checkpoint.", job_id)


class Worker:
    def __init__(self, settings: AppSettings, sessions: sessionmaker[Session] | None = None,
                 gateway_for: GatewayFactory | None = None):
        self.settings = settings
        self.sessions = sessions or session_factory(settings.database_url)
        self.gateway_for = gateway_for or (lambda _job: get_gateway(settings))
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}"
        self.stop_event = threading.Event()

    @property
    def stopping(self) -> bool:
        return self.stop_event.is_set()

    @stopping.setter
    def stopping(self, value: bool) -> None:
        self.stop_event.set() if value else self.stop_event.clear()

    def beat(self) -> None:
        if self.settings.worker_heartbeat_file:
            Path(self.settings.worker_heartbeat_file).write_text(str(time.time()))

    def requeue_stale(self) -> None:
        with self.sessions() as session:
            requeued = queue.requeue_stale(session)
        if requeued:
            log.info("requeued %d job(s) left running by a stopped worker", requeued)

    def check_mode(self) -> None:
        """Raise ModeMismatch if the database belongs to the other mode: a dry-run worker would write
        simulated counts into a live installation's matters and logs."""
        with self.sessions() as session:
            repositories.check_mode(session, dry_run=self.settings.dry_run)

    def loop(self, *, once: bool = False) -> None:
        self.check_mode()
        last_requeue: float | None = None  # None: sweep at once (monotonic() starts near 0 after boot)
        while not self.stopping:
            self.beat()
            try:
                if last_requeue is None or time.monotonic() - last_requeue >= REQUEUE_SECONDS:
                    self.requeue_stale()
                    last_requeue = time.monotonic()
                with self.sessions() as session:
                    did_work = run_one(session, self.worker_id, self.gateway_for, sessions=self.sessions,
                                       beat=self.beat, stop=self.stop_event)
            except Exception:  # noqa: BLE001 - the database is down, say: keep trying, don't exit
                log.exception("the worker loop failed; trying again in %.0fs", LOOP_ERROR_SECONDS)
                if once:
                    return
                self.stop_event.wait(LOOP_ERROR_SECONDS)
                continue
            if once:
                return
            if not did_work:
                self.stop_event.wait(self.settings.worker_poll_seconds)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="searchtrail-worker", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--once", action="store_true", help="run at most one job, then exit")
    args = parser.parse_args(argv)
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s %(message)s")
    settings = get_settings()
    worker = Worker(settings)

    def stop(*_args) -> None:
        worker.stopping = True

    signal.signal(signal.SIGTERM, stop)
    signal.signal(signal.SIGINT, stop)
    log.info("worker %s started (dry run: %s)", worker.worker_id, settings.dry_run)
    try:
        worker.loop(once=args.once)
    except repositories.ModeMismatch as exc:
        log.error("%s", exc)
        return 2
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
