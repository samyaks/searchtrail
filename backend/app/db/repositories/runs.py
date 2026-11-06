"""Runs (estimate, preview, term report of one query version) and the preview's item rows.

These are the functions WS-B2's job handlers write through (docs/PHASE1_PLAN.md, the B1 and B2 seams).
"""
from __future__ import annotations

from collections.abc import Iterable
from typing import Any

from sqlalchemy import insert
from sqlalchemy.orm import Session

from ..base import new_id, utcnow
from ..models import PreviewItemRow, RunRow

RUN_KINDS = ("estimate", "preview", "term_report")
FINISHED = ("succeeded", "failed")
_ITEM_COLUMNS = {c.key for c in PreviewItemRow.__table__.columns} - {"id", "run_id"}


def create_run(session: Session, *, matter_id: str, query_version_id: str, kind: str,
               created_by: str | None) -> RunRow:
    """Start a run (status `running`)."""
    if kind not in RUN_KINDS:
        raise ValueError(f"create_run: kind must be one of {RUN_KINDS}, not {kind!r}")
    run = RunRow(id=new_id("run"), matter_id=matter_id, query_version_id=query_version_id, kind=kind,
                 status="running", files=[], created_by=created_by)
    session.add(run)
    session.flush()
    return run


def finish_run(session: Session, run: RunRow, *, status: str, counts: dict[str, Any] | None = None,
               result: dict[str, Any] | None = None, files: list[dict[str, Any]] | None = None) -> None:
    """Finish a run. `counts` is a contract Counts dict; `result` holds breakdowns or term rows;
    `files` lists stored report files (left unchanged when None)."""
    if status not in FINISHED:
        raise ValueError(f"finish_run: status must be one of {FINISHED}, not {status!r}")
    run.status = status
    run.counts = counts
    run.result = result
    if files is not None:
        run.files = files
    run.finished_at = utcnow()
    session.flush()


def add_preview_items(session: Session, run_id: str, items: Iterable[dict[str, Any]], *, batch_size: int = 1000) -> int:
    """Insert a preview's item rows in batches (items can be a generator, so a large report is never
    held in memory). Keys are PreviewItemRow columns: item_id, title, location, type, date, label,
    size_bytes, encrypted. Returns the number of rows written."""
    total = 0
    batch: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal total, batch
        if batch:
            session.execute(insert(PreviewItemRow), batch)
            total += len(batch)
            batch = []

    for item in items:
        unknown = item.keys() - _ITEM_COLUMNS
        if unknown:
            raise ValueError(f"add_preview_items: unknown columns {sorted(unknown)}")
        batch.append({**item, "run_id": run_id})
        if len(batch) >= batch_size:
            flush()
    flush()
    return total
