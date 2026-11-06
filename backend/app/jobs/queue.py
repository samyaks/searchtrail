"""Job table access. Every function takes a Session and leaves committing to the caller,
except claim_next(), which commits so the claim is visible to other workers at once."""
from __future__ import annotations

from datetime import datetime, timedelta
from typing import Any

from sqlalchemy import select, update
from sqlalchemy.orm import Session

from app.db.base import new_id, utcnow
from app.db.models import JobRow

JOB_KINDS = ("estimate", "preview", "term_report", "export", "download", "review_set")
# A running job whose worker hasn't sent a heartbeat for this long is assumed dead and requeued.
STALE_AFTER = timedelta(minutes=5)


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
    """Take the oldest queued job that is due. SKIP LOCKED lets several workers run safely."""
    now = utcnow()
    job = session.execute(
        select(JobRow)
        .where(JobRow.status == "queued", JobRow.run_after <= now)
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


def heartbeat(session: Session, job: JobRow, *, progress: float | None = None,
              checkpoint: dict[str, Any] | None = None) -> None:
    """Record that the job is alive, and optionally its progress and where it is up to."""
    job.heartbeat_at = job.updated_at = utcnow()
    if progress is not None:
        job.progress = max(0.0, min(1.0, progress))
    if checkpoint is not None:
        job.checkpoint = checkpoint
    session.commit()


def touch(session: Session, job_id: str) -> None:
    """Heartbeat by ID from another session (the worker's background thread)."""
    session.execute(update(JobRow).where(JobRow.id == job_id, JobRow.status == "running")
                    .values(heartbeat_at=utcnow()))
    session.commit()


def finish(session: Session, job: JobRow, result: dict[str, Any] | None) -> None:
    job.status, job.progress, job.result, job.error = "succeeded", 1.0, result, None
    job.locked_by = None
    job.updated_at = utcnow()
    session.commit()


def fail(session: Session, job: JobRow, code: str, message: str, details: dict[str, Any] | None = None) -> None:
    """`code` is a contract ErrorCode; `message` is shown to the user."""
    job.status = "failed"
    job.error = {"code": code, "message": message, "details": details or {}}
    job.locked_by = None
    job.updated_at = utcnow()
    session.commit()


def requeue_stale(session: Session, older_than: timedelta = STALE_AFTER) -> int:
    """Put jobs whose worker died back in the queue. Their checkpoint (for example a Purview
    operation URL) is kept, so the handler resumes instead of starting the Purview action again."""
    cutoff = utcnow() - older_than
    result = session.execute(
        update(JobRow)
        .where(JobRow.status == "running", JobRow.heartbeat_at < cutoff)
        .values(status="queued", locked_by=None, updated_at=utcnow())
    )
    session.commit()
    return result.rowcount or 0
