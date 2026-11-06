"""Job kind -> task function. Phase 0 registers none; WS-B2 adds estimate, preview, term_report,
export, download and review_set.

A handler gets a JobContext and returns the job result (a dict matching the contract's result
schema for that kind) or raises JobFailed. Handlers must be resumable: read ctx.job.checkpoint
first, and save progress with ctx.heartbeat(checkpoint=...) right after starting any Purview
operation, so a restarted worker polls the same operation instead of starting a new one.
"""
from __future__ import annotations

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


@dataclass
class JobContext:
    session: Session
    job: JobRow
    gateway: PurviewGateway

    def heartbeat(self, *, progress: float | None = None, checkpoint: dict[str, Any] | None = None) -> None:
        queue.heartbeat(self.session, self.job, progress=progress, checkpoint=checkpoint)


Handler = Callable[[JobContext], dict[str, Any] | None]
HANDLERS: dict[str, Handler] = {}


def register(kind: str) -> Callable[[Handler], Handler]:
    def decorator(fn: Handler) -> Handler:
        HANDLERS[kind] = fn
        return fn

    return decorator
