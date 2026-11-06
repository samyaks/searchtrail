"""Repositories: the only code that reads and writes the tables for the API and the jobs.

Rules for every function here:
- Take the caller's Session; flush, never commit. The caller (a request, or a job handler) owns the
  transaction, so a failure rolls back everything it did, log entries included.
- Return rows or small dataclasses; turning them into contract models is app/schemas' job.

WS-B2's job handlers write only through `create_run`, `finish_run`, `add_preview_items` and
`append_log` (the seams in docs/PHASE1_PLAN.md).
"""
from .log import SYSTEM_ACTOR, append_log
from .matters import (
    MatterDetail,
    MatterListing,
    create_matter,
    draft_changed,
    get_matter,
    list_matters,
    matter_detail,
    matter_number_taken,
    sources_fingerprint,
    update_matter,
)
from .runs import add_preview_items, create_run, finish_run
from .users import ensure_user

__all__ = [
    "SYSTEM_ACTOR",
    "MatterDetail",
    "MatterListing",
    "add_preview_items",
    "append_log",
    "create_matter",
    "create_run",
    "draft_changed",
    "ensure_user",
    "finish_run",
    "get_matter",
    "list_matters",
    "matter_detail",
    "matter_number_taken",
    "sources_fingerprint",
    "update_matter",
]
