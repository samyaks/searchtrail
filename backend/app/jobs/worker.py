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
import time
from collections.abc import Callable
from pathlib import Path

from sqlalchemy.orm import Session, sessionmaker

from app.db.models import JobRow
from app.db.session import session_factory
from app.microsoft import get_gateway
from app.settings import AppSettings, get_settings
from searchtrail.gateway import PurviewGateway

from . import queue
from .handlers import HANDLERS, JobContext, JobFailed

log = logging.getLogger("searchtrail.worker")


GatewayFactory = Callable[[JobRow], PurviewGateway]


def run_one(session: Session, worker_id: str, gateway_for: GatewayFactory) -> bool:
    """Claim and run one job. Returns False when there was nothing to do."""
    job = queue.claim_next(session, worker_id)
    if job is None:
        return False
    handler = HANDLERS.get(job.kind)
    log.info("job %s (%s) started, attempt %d", job.id, job.kind, job.attempts)
    if handler is None:
        queue.fail(session, job, "internal_error", f"This version of SearchTrail can't run '{job.kind}' jobs yet.")
        return True
    try:
        # Built per job: the live gateway acts as the user who started the job.
        queue.finish(session, job, handler(JobContext(session, job, gateway_for(job))))
        log.info("job %s succeeded", job.id)
    except JobFailed as exc:
        session.rollback()
        queue.fail(session, job, exc.code, exc.message, exc.details)
        log.warning("job %s failed: %s", job.id, exc.message)
    except Exception as exc:  # noqa: BLE001 - a bad job must not stop the worker
        session.rollback()
        queue.fail(session, job, "internal_error", "Something went wrong running this job. It has been logged.",
                   {"type": type(exc).__name__})
        log.exception("job %s crashed", job.id)
    return True


class Worker:
    def __init__(self, settings: AppSettings, sessions: sessionmaker[Session] | None = None,
                 gateway_for: GatewayFactory | None = None):
        self.settings = settings
        self.sessions = sessions or session_factory(settings.database_url)
        self.gateway_for = gateway_for or (lambda _job: get_gateway(settings))
        self.worker_id = f"{socket.gethostname()}:{os.getpid()}"
        self.stopping = False

    def beat(self) -> None:
        if self.settings.worker_heartbeat_file:
            Path(self.settings.worker_heartbeat_file).write_text(str(time.time()))

    def loop(self, *, once: bool = False) -> None:
        with self.sessions() as session:
            requeued = queue.requeue_stale(session)
            if requeued:
                log.info("requeued %d job(s) left running by a stopped worker", requeued)
        while not self.stopping:
            self.beat()
            with self.sessions() as session:
                did_work = run_one(session, self.worker_id, self.gateway_for)
            if once:
                return
            if not did_work:
                time.sleep(self.settings.worker_poll_seconds)


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
    worker.loop(once=args.once)
    log.info("worker stopped")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
