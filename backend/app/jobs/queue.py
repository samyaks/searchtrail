"""Job table access. Every function takes a Session; the ones that record what a running job did commit,
and the rest leave committing to the caller.

A job's status:

  queued     waiting to start, or to be tried again (run_after says when)
  running    a worker holds it (locked_by) and is running its handler
  waiting    between two checks of a Purview operation: no worker holds it, and any worker takes it
             again at run_after. The API shows it as `running` (contract_status): to the person who
             started it, the job is under way.
  succeeded, failed

Only the worker that holds a running job may write about it (heartbeat, finish, fail, retry_later,
wait take `owner`, its worker ID). A worker whose heartbeat went quiet for STALE_AFTER loses the job to
requeue_stale, and if it carries on afterwards (it was paused, not dead), its writes raise LostJob and
are rolled back instead of landing on top of the worker that has the job now.
"""
from __future__ import annotations

import logging
from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.base import new_id, utcnow
from app.db.models import JobRow

log = logging.getLogger("searchtrail.jobs")

JOB_KINDS = ("estimate", "preview", "term_report", "export", "download", "review_set")
# A running job whose worker hasn't sent a heartbeat for this long is assumed dead and requeued.
STALE_AFTER = timedelta(minutes=5)
# A job fails for good once it has been tried this many times: retried after passing trouble
# (JobRetry), or requeued after its worker stopped mid-job.
MAX_ATTEMPTS = 6
CLAIMABLE = ("queued", "waiting")


class LostJob(RuntimeError):
    """The worker no longer holds the job: it was requeued (its heartbeat went quiet) and may be running
    elsewhere. What this worker was about to record about it has been rolled back."""


def contract_status(status: str) -> str:
    """The contract's JobStatus for a job row's status."""
    return "running" if status == "waiting" else status


def enqueue(session: Session, kind: str, *, matter_id: str | None = None, payload: dict[str, Any] | None = None,
            created_by: str | None = None, run_after: datetime | None = None) -> JobRow:
    if kind not in JOB_KINDS:
        raise ValueError(f"Unknown job kind {kind!r}; expected one of {', '.join(JOB_KINDS)}")
    now = utcnow()
    job = JobRow(id=new_id("job"), kind=kind, status="queued", progress=0.0, matter_id=matter_id,
                 payload=payload or {}, checkpoint={}, created_by=created_by, run_after=run_after or now,
                 created_at=now, updated_at=now, attempts=0)
    session.add(job)
    session.flush()
    return job


def claim_next(session: Session, worker_id: str) -> JobRow | None:
    """Take the oldest job that is due, queued or waiting, and commit the claim so other workers see it at
    once. SKIP LOCKED lets several workers run safely."""
    now = utcnow()
    job = session.execute(
        select(JobRow)
        .where(JobRow.status.in_(CLAIMABLE), JobRow.run_after <= now)
        .order_by(JobRow.created_at)
        .limit(1)
        .with_for_update(skip_locked=True)
    ).scalar_one_or_none()
    if job is None:
        session.rollback()
        return None
    job.status = "running"
    job.locked_by = worker_id
    job.heartbeat_at = now
    job.updated_at = now
    job.attempts += 1
    session.commit()
    return job


def _hold(session: Session, job: JobRow, owner: str) -> None:
    """Lock the job's row and check `owner` still holds it, before writing about it. The lock lasts until
    the commit, so requeue_stale can't take the job between this check and the write. `owner` is passed
    in, never read from `job`: after a rollback, `job` reloads from the database, where locked_by may be
    another worker's ID by now."""
    row = session.execute(
        select(JobRow.status, JobRow.locked_by).where(JobRow.id == job.id).with_for_update()
    ).one_or_none()
    if row is None or row.status != "running" or row.locked_by != owner:
        session.rollback()
        held = f"{row.status}, held by {row.locked_by}" if row else "gone"
        raise LostJob(f"Job {job.id} is no longer held by {owner} (now {held}).")


def heartbeat(session: Session, job: JobRow, *, owner: str, progress: float | None = None,
              checkpoint: dict[str, Any] | None = None) -> None:
    """Record that the job is alive, and optionally its progress and where it is up to. Commits, with
    whatever the handler has written so far."""
    _hold(session, job, owner)
    job.heartbeat_at = job.updated_at = utcnow()
    if progress is not None:
        job.progress = max(0.0, min(1.0, progress))
    if checkpoint is not None:
        job.checkpoint = checkpoint
    session.commit()


def touch(session: Session, job_id: str, owner: str) -> None:
    """Heartbeat by ID from another session (the worker's background thread). Does nothing once the
    job isn't this worker's."""
    session.execute(update(JobRow).where(JobRow.id == job_id, JobRow.status == "running", JobRow.locked_by == owner)
                    .values(heartbeat_at=utcnow()))
    session.commit()


def finish(session: Session, job: JobRow, result: dict[str, Any] | None, *, owner: str) -> None:
    """Commits the handler's writes together with the result, or none of them (LostJob)."""
    _hold(session, job, owner)
    job.status, job.progress, job.result, job.error = "succeeded", 1.0, result, None
    job.locked_by = None
    job.updated_at = utcnow()
    session.commit()


def fail(session: Session, job: JobRow, code: str, message: str, details: dict[str, Any] | None = None, *,
         owner: str) -> None:
    """`code` is a contract ErrorCode; `message` is shown to the user."""
    _hold(session, job, owner)
    job.status = "failed"
    job.error = {"code": code, "message": message, "details": details or {}}
    job.locked_by = None
    job.updated_at = utcnow()
    session.commit()


def retry_later(session: Session, job: JobRow, after: timedelta, *, owner: str) -> None:
    """Put a running job back in the queue, due after `after`, with its checkpoint and progress kept.
    This counts as one of its MAX_ATTEMPTS."""
    _hold(session, job, owner)
    job.status, job.locked_by, job.run_after = "queued", None, utcnow() + after
    job.updated_at = utcnow()
    session.commit()


def wait(session: Session, job: JobRow, after: timedelta, *, owner: str) -> None:
    """Let go of a job that is waiting on Purview, to check again after `after`. Meanwhile the worker runs
    other jobs. Doesn't count as an attempt: nothing went wrong."""
    _hold(session, job, owner)
    job.status, job.locked_by, job.run_after = "waiting", None, utcnow() + after
    job.attempts = max(0, job.attempts - 1)
    job.updated_at = utcnow()
    session.commit()


def requeue_stale(session: Session, older_than: timedelta = STALE_AFTER) -> int:
    """Put jobs whose worker died back in the queue; returns how many. Their checkpoint (for example a
    Purview operation URL) is kept, so the handler resumes instead of starting the Purview action again.

    A job already tried MAX_ATTEMPTS times fails instead: a job that keeps stopping its worker (running
    it out of memory, say) would otherwise be picked up again every few minutes, forever."""
    now = utcnow()
    stale = (JobRow.status == "running", JobRow.heartbeat_at < now - older_than)
    gave_up = session.execute(
        update(JobRow).where(*stale, JobRow.attempts >= MAX_ATTEMPTS).values(
            status="failed", locked_by=None, updated_at=now,
            error={"code": "internal_error", "details": {"attempts": MAX_ATTEMPTS},
                   "message": f"This job stopped SearchTrail's worker {MAX_ATTEMPTS} times, so it won't be tried "
                              "again. It has been logged."}))
    requeued = session.execute(update(JobRow).where(*stale).values(status="queued", locked_by=None, updated_at=now))
    session.commit()
    if gave_up.rowcount:
        log.error("failed %d job(s) that stopped their worker %d times", gave_up.rowcount, MAX_ATTEMPTS)
    return requeued.rowcount or 0
