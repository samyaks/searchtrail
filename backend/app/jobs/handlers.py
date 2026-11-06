"""Job kind -> task function. Phase 0 registers none; WS-B2 adds estimate, preview, term_report,
export, download and review_set.

A handler gets a JobContext and returns the job result (a dict matching the contract's result
schema for that kind) or raises JobFailed. Handlers must be resumable: read ctx.job.checkpoint
first, and save progress with ctx.heartbeat(checkpoint=...) right after starting any Purview
operation, so a restarted worker polls the same operation instead of starting a new one.
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
    throttling, a 503, a dropped connection, or the worker being stopped.

    `code` and `message` are what the job fails with if it still hasn't worked after
    queue.MAX_ATTEMPTS tries. `counts_as_attempt=False` is for a requested stop, which isn't the job's
    fault."""

    def __init__(self, after_seconds: float, code: str, message: str, details: dict[str, Any] | None = None, *,
                 counts_as_attempt: bool = True):
        super().__init__(message)
        self.after_seconds, self.code, self.message = after_seconds, code, message
        self.details, self.counts_as_attempt = details or {}, counts_as_attempt


@dataclass
class JobContext:
    session: Session
    job: JobRow
    gateway: PurviewGateway
    # Set when the worker has been asked to stop (SIGTERM). Long waits watch it, so a stop doesn't
    # have to wait out a multi-hour poll. None where there's no worker (tests, scripts).
    stop: threading.Event | None = None

    def heartbeat(self, *, progress: float | None = None, checkpoint: dict[str, Any] | None = None) -> None:
        queue.heartbeat(self.session, self.job, progress=progress, checkpoint=checkpoint)


Handler = Callable[[JobContext], dict[str, Any] | None]
HANDLERS: dict[str, Handler] = {}


def register(kind: str) -> Callable[[Handler], Handler]:
    def decorator(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return decorator
