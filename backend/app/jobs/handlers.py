"""Job kind -> task function. WS-B2 registers estimate (estimate.py), then preview, term_report,
export, download and review_set.

A handler gets a JobContext and returns the job result (a dict matching the contract's result
schema for that kind) or raises JobFailed, JobRetry or JobWait. Handlers must be resumable: read
ctx.job.checkpoint first, and save progress with ctx.heartbeat(checkpoint=...) right after starting any
Purview operation, so the next run polls the same operation instead of starting a new one. A job is run
from the top again after every JobWait and JobRetry, and after a worker dies, so everything before the
checkpointed step must be safe to repeat.
"""
from __future__ import annotations

import threading
from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from sqlalchemy.orm import Session

from app.db.models import JobRow
from searchtrail.gateway import PurviewGateway

from . import queue


class JobFailed(Exception):
    def __init__(self, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.code, self.message, self.details = code, message, details or {}


class JobRetry(Exception):
    """Put the job back in the queue to run again later, keeping its checkpoint (so a Purview operation
    already started is polled again, never restarted). For trouble that usually passes: Microsoft
    throttling, a 503, a dropped connection, the database going away for a moment.

    `code` and `message` are what the job fails with if it still hasn't worked after
    queue.MAX_ATTEMPTS tries."""

    def __init__(self, after_seconds: float, code: str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.after_seconds, self.code, self.message, self.details = after_seconds, code, message, details or {}


class JobWait(Exception):
    """The job is waiting on Purview: let go of it and run it again in `after_seconds`. The worker runs
    other jobs meanwhile, so an export that takes an hour doesn't hold up everyone else's estimates.
    Not a failure, and not an attempt. Raise it only after ctx.heartbeat has saved the checkpoint."""

    def __init__(self, after_seconds: float):
        super().__init__(f"waiting {after_seconds:.0f}s")
        self.after_seconds = after_seconds


@dataclass
class JobContext:
    session: Session
    job: JobRow
    gateway: PurviewGateway
    # The worker holding the job. Only it may write about the job (see queue.LostJob).
    owner: str
    # Set when the worker has been asked to stop (SIGTERM), for a handler blocked in one long call (a
    # download) to notice. None where there's no worker (tests, scripts).
    stop: threading.Event | None = None

    def heartbeat(self, *, progress: float | None = None, checkpoint: dict[str, Any] | None = None) -> None:
        """Save progress and the checkpoint, committing everything the handler has written so far.
        Raises queue.LostJob if another worker has the job now."""
        queue.heartbeat(self.session, self.job, owner=self.owner, progress=progress, checkpoint=checkpoint)


Handler = Callable[[JobContext], dict[str, Any] | None]
HANDLERS: dict[str, Handler] = {}


def register(kind: str) -> Callable[[Handler], Handler]:
    def decorator(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return decorator
