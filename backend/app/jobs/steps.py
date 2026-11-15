"""The pattern every Purview job follows: start an operation, checkpoint it, poll it, finish.

    if "operation_url" not in ctx.job.checkpoint:      # a resumed job skips straight to polling
        url = gateway.start_estimate(...)
        ctx.heartbeat(checkpoint={**ctx.job.checkpoint, "operation_url": url})   # commits
    op = poll_operation(ctx, progress=(0.1, 0.95))   # returns when Purview is done; until then JobWait

The checkpoint commit is what makes a job resumable: a worker that dies after it leaves the URL
behind, and the next run polls that same operation instead of starting another. poll_operation checks
the operation once; while it's still running it saves progress and raises JobWait, so the worker runs
other jobs and comes back to this one, and every check runs the handler from the top again.

There is a small window between a start call and its checkpoint commit: a worker dying inside it starts
the action again on the next run. For estimates and reports that is harmless (they read, and the extra
one is never used). A handler that starts something that must not happen twice (an export) has to look
for it before starting again.
"""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from datetime import datetime, timedelta
from typing import Any

from app.db.base import utcnow
from app.db.models import UserRow
from app.db.repositories import SYSTEM_ACTOR
from app.microsoft.errors import classify
from app.schemas import contract
from searchtrail.gateway import counts_from_operation as purview_counts
from searchtrail.graph import FAILED_STATES, TERMINAL_STATES
from searchtrail.workflow import SourcesMismatch

from .handlers import JobContext, JobFailed, JobRetry, JobWait

# Polling: like GraphClient.wait_for_operation, checking less often as time goes on, and giving up after
# POLL_TIMEOUT_SECONDS from the first check (kept in the checkpoint, so retries and restarts don't reset it).
POLL_FIRST_SECONDS = 5.0
POLL_MAX_SECONDS = 30.0
POLL_TIMEOUT_SECONDS = 4 * 3600.0
# Retrying a throttled or failing Purview call: wait this long, times the attempt number, at most this long.
RETRY_STEP_SECONDS = 60.0
RETRY_MAX_SECONDS = 900.0


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


def poll_operation(ctx: JobContext, *, progress: tuple[float, float] = (0.0, 1.0),
                   label: str = "operation") -> dict[str, Any]:
    """Check the Purview operation in the job's checkpoint (`operation_url`). Returns it once finished;
    raises JobFailed if Purview says it failed or it has run past the timeout. While it's still running,
    saves its percentProgress as job progress (scaled into `progress`) and raises JobWait.

    The checkpoint's `poll` entry holds when polling began and the next wait."""
    checkpoint = dict(ctx.job.checkpoint)
    with purview_errors(ctx):
        op = ctx.gateway.get_operation(checkpoint["operation_url"])
    status = op.get("status")
    if status in TERMINAL_STATES:
        if status in FAILED_STATES:
            raise JobFailed("purview_operation_failed",
                            f"Purview couldn't finish the {label}. Try again; if it keeps failing, check the case "
                            "in the Purview portal.",
                            {"operation_status": status, "result_info": op.get("resultInfo")})
        return op
    poll = checkpoint.get("poll") or {"since": utcnow().isoformat(), "delay": POLL_FIRST_SECONDS}
    if utcnow() - datetime.fromisoformat(poll["since"]) >= timedelta(seconds=POLL_TIMEOUT_SECONDS):
        raise JobFailed("purview_operation_failed",
                        f"Purview's {label} was still '{status}' after {POLL_TIMEOUT_SECONDS / 3600:.0f} hours.",
                        {"operation_status": status})
    start, end = progress
    checkpoint["poll"] = {"since": poll["since"], "delay": min(POLL_MAX_SECONDS, poll["delay"] * 1.5)}
    ctx.heartbeat(progress=start + (end - start) * (op.get("percentProgress") or 0) / 100, checkpoint=checkpoint)
    raise JobWait(poll["delay"])


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
