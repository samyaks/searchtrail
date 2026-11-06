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
from typing import Any

from app.db.models import JobRow, UserRow
from app.db.repositories import SYSTEM_ACTOR
from app.schemas import contract
from searchtrail.graph import FAILED_STATES, TERMINAL_STATES

from .handlers import JobContext, JobFailed

# Polling: like GraphClient.wait_for_operation, but heartbeating progress and never blocking for good.
POLL_FIRST_SECONDS = 5.0
POLL_MAX_SECONDS = 30.0
POLL_TIMEOUT_SECONDS = 4 * 3600.0
sleep = time.sleep  # tests replace this


def poll_operation(ctx: JobContext, url: str, *, progress: tuple[float, float] = (0.0, 1.0),
                   label: str = "operation") -> dict[str, Any]:
    """Poll a Purview operation until it finishes, reporting its percentProgress as job progress
    scaled into `progress`. Returns the finished operation; raises JobFailed if Purview says it failed
    or it runs past the timeout."""
    start, end = progress
    delay, waited = POLL_FIRST_SECONDS, 0.0
    while True:
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
        sleep(delay)
        waited += delay
        delay = min(POLL_MAX_SECONDS, delay * 1.5)


def counts_from_operation(op: dict[str, Any]) -> dict[str, Any]:
    """A finished estimate operation's counts, as the contract's Counts."""
    return contract.Counts(
        items=op.get("indexedItemCount") or 0,
        size_bytes=op.get("indexedItemsSize") or 0,
        partial_items=op.get("unindexedItemCount") or 0,
        partial_size_bytes=op.get("unindexedItemsSize") or 0,
        mailboxes=op.get("mailboxCount") or 0,
        sites=op.get("siteCount") or 0,
    ).model_dump(mode="json")


def counts_summary(version: int, counts: dict[str, Any]) -> str:
    """'Query v3 · 630 items + 25 partially indexed', the Log screen's line for a count."""
    return f"Query v{version} · {counts['items']:,} items + {counts['partial_items']:,} partially indexed"


def actor_of(ctx: JobContext, job: JobRow | None = None) -> tuple[str, str | None]:
    """(display name, email) of the person who started the job, for the log."""
    job = job or ctx.job
    user = ctx.session.get(UserRow, job.created_by) if job.created_by else None
    return (user.display_name, user.email) if user else (SYSTEM_ACTOR, None)
