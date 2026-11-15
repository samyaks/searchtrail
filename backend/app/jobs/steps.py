"""The pattern every Purview job follows: start an operation, checkpoint it, poll it, finish.

    if "operation_url" not in ctx.job.checkpoint:      # a resumed job skips straight to polling
        url = gateway.start_estimate(...)
        ctx.heartbeat(checkpoint={"step": "polling", "operation_url": url, ...})   # commits
    op = poll_operation(ctx, ctx.job.checkpoint["operation_url"], progress=(0.1, 0.95))

The checkpoint commit is what makes a job resumable: a worker that dies after it leaves the URL
behind, and the next worker polls that same operation instead of starting another. There is a small
window between the start call and the commit; a worker dying inside it starts the action again on
retry, which is why the read-only steps (estimates, reports) are the ones started this way.
"""
from __future__ import annotations

import time
from collections.abc import Iterator
from contextlib import contextmanager
from typing import Any

from app.db.models import UserRow
from app.db.repositories import SYSTEM_ACTOR
from app.microsoft.errors import classify
from app.schemas import contract
from searchtrail.gateway import counts_from_operation as purview_counts
from searchtrail.graph import FAILED_STATES, TERMINAL_STATES
from searchtrail.workflow import SourcesMismatch

from .handlers import JobContext, JobFailed, JobRetry

# Polling: like GraphClient.wait_for_operation, but heartbeating progress and never blocking for good.
POLL_FIRST_SECONDS = 5.0
POLL_MAX_SECONDS = 30.0
POLL_TIMEOUT_SECONDS = 4 * 3600.0
sleep = time.sleep  # tests replace this
# Retrying a throttled or failing Purview call: wait this long, times the attempt number, at most this long.
RETRY_STEP_SECONDS = 60.0
RETRY_MAX_SECONDS = 900.0


def wait(ctx: JobContext, seconds: float) -> None:
    """Sleep, ending early if the worker is asked to stop."""
    if ctx.stop is not None:
        ctx.stop.wait(seconds)
    else:
        sleep(seconds)


@contextmanager
def purview_errors(ctx: JobContext) -> Iterator[None]:
    """Turn what a Microsoft call raises into a job outcome, using app.microsoft.errors.classify (the
    same codes the API returns):

      transient (429, 5xx, no connection)   JobRetry: try again later, the checkpoint is kept
      anything else Microsoft                JobFailed with the classified code (401 session_expired,
                                             403 purview_permission_missing, else purview_operation_failed)
      a source with other settings           conflict (SourcesMismatch)

    Wrap every block of Purview calls in a handler with it."""
    try:
        yield
    except SourcesMismatch as exc:
        raise JobFailed("conflict", str(exc), {"custodian": exc.email, "wanted": exc.wanted, "found": exc.found}) from exc
    except Exception as exc:
        failure = classify(exc)
        if failure is None:
            raise
        if failure.transient:
            raise JobRetry(min(RETRY_MAX_SECONDS, RETRY_STEP_SECONDS * ctx.job.attempts), failure.code,
                           f"{failure.message} SearchTrail will try again shortly.", failure.details) from exc
        raise JobFailed(failure.code, failure.message, failure.details) from exc


def poll_operation(ctx: JobContext, url: str, *, progress: tuple[float, float] = (0.0, 1.0),
                   label: str = "operation") -> dict[str, Any]:
    """Poll a Purview operation until it finishes, reporting its percentProgress as job progress
    scaled into `progress`. Returns the finished operation; raises JobFailed if Purview says it failed
    or it runs past the timeout."""
    start, end = progress
    delay, waited = POLL_FIRST_SECONDS, 0.0
    while True:
        if ctx.stop is not None and ctx.stop.is_set():
            # The worker is shutting down. The checkpoint holds the operation URL, so whichever worker
            # picks the job up next polls the same operation.
            raise JobRetry(0, "purview_operation_failed", "SearchTrail was stopped. The job will resume.",
                           counts_as_attempt=False)
        with purview_errors(ctx):
            op = ctx.gateway.get_operation(url)
        status = op.get("status")
        if status in TERMINAL_STATES:
            if status in FAILED_STATES:
                raise JobFailed("purview_operation_failed",
                                f"Purview couldn't finish the {label}. Try again; if it keeps failing, check the case "
                                "in the Purview portal.",
                                {"operation_status": status, "result_info": op.get("resultInfo")})
            return op
        if waited >= POLL_TIMEOUT_SECONDS:
            raise JobFailed("purview_operation_failed",
                            f"Purview's {label} was still '{status}' after {POLL_TIMEOUT_SECONDS / 3600:.0f} hours.",
                            {"operation_status": status})
        pct = op.get("percentProgress")
        ctx.heartbeat(progress=start + (end - start) * (pct or 0) / 100)
        wait(ctx, delay)
        waited += delay
        delay = min(POLL_MAX_SECONDS, delay * 1.5)


def counts_from_operation(op: dict[str, Any]) -> dict[str, Any]:
    """A finished estimate operation's counts, as the contract's Counts (the field names are Purview's,
    from searchtrail.gateway.COUNT_FIELDS)."""
    raw = purview_counts(op)
    return contract.Counts(
        items=raw["indexedItemCount"] or 0,
        size_bytes=raw["indexedItemsSize"] or 0,
        partial_items=raw["unindexedItemCount"] or 0,
        partial_size_bytes=raw["unindexedItemsSize"] or 0,
        mailboxes=raw["mailboxCount"] or 0,
        sites=raw["siteCount"] or 0,
    ).model_dump(mode="json")


def counts_summary(version: int, counts: dict[str, Any]) -> str:
    """'Query v3 · 630 items + 25 partially indexed', the Log screen's line for a count."""
    return f"Query v{version} · {counts['items']:,} items + {counts['partial_items']:,} partially indexed"


def actor_of(ctx: JobContext) -> tuple[str, str | None]:
    """(display name, email) of the person who started the job, for the log."""
    user = ctx.session.get(UserRow, ctx.job.created_by) if ctx.job.created_by else None
    return (user.display_name, user.email) if user else (SYSTEM_ACTOR, None)
