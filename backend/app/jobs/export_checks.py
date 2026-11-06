"""The export checks: the one function behind POST /matters/{id}/exports/check and the export job.

Three checks, in order:
  previewed         the current query version has a finished preview
  same_sources      the custodians and sites are the ones that preview searched
  counts_unchanged  a fresh estimate matches the preview's counts (new mail arrives, items get deleted)

The first two come from the database and make no Purview calls, so an export they block changes
nothing in Purview. The third runs one estimate, and only when the first two passed.
"""
from __future__ import annotations

from datetime import datetime

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.base import utcnow
from app.db.models import MatterRow, QueryVersionRow, RunRow
from app.schemas import contract
from searchtrail.gateway import PurviewGateway

from .steps import counts_from_operation

# What has to match between the preview and now: the counts the export would collect.
DRIFT = (("items", "items"), ("partial_items", "partially indexed items"))


def _when(moment: datetime) -> str:
    return f"{moment:%d %b %Y %H:%M} UTC"


def _latest_preview(session: Session, matter_id: str, version_id: str | None = None) -> tuple[RunRow, QueryVersionRow] | None:
    query = (select(RunRow, QueryVersionRow).join(QueryVersionRow, QueryVersionRow.id == RunRow.query_version_id)
             .where(RunRow.matter_id == matter_id, RunRow.kind == "preview", RunRow.status == "succeeded"))
    if version_id:
        query = query.where(RunRow.query_version_id == version_id)
    row = session.execute(query.order_by(RunRow.finished_at.desc(), RunRow.created_at.desc()).limit(1)).first()
    return (row[0], row[1]) if row else None


def check_export(session: Session, gateway: PurviewGateway, matter_id: str) -> contract.ExportCheck:
    """Run the export checks for the matter's current query version. Raises LookupError for an unknown
    matter. `blocked_code` is the error a real export would return now."""
    matter = session.get(MatterRow, matter_id)
    if matter is None:
        raise LookupError(f"check_export: no matter {matter_id!r}")
    version = None
    if matter.current_version is not None:
        version = session.scalars(select(QueryVersionRow).where(
            QueryVersionRow.matter_id == matter_id, QueryVersionRow.version == matter.current_version)).one_or_none()
    latest = _latest_preview(session, matter_id)  # the preview the user last saw, of any version
    current = _latest_preview(session, matter_id, version.id) if version else None
    checks: list[contract.ExportCheckItem] = []

    def check(key: str, status: str, message: str) -> bool:
        checks.append(contract.ExportCheckItem(key=key, status=status, message=message))
        return status == "passed"

    if version is None:
        previewed = check("previewed", "failed", "There's no query to export yet. Estimate and preview one first.")
    elif current is None or not version.purview_search_id:
        previewed = check("previewed", "failed", f"Query v{version.version} hasn't been previewed. Preview it first, "
                          "so the export matches what was reviewed.")
    else:
        previewed = check("previewed", "passed",
                          f"This exact query (v{version.version}) was previewed at {_when(current[0].finished_at)}.")

    compare_with = current or latest
    if compare_with is None:
        same_sources = check("same_sources", "skipped", "Not checked because nothing has been previewed.")
    elif repositories.sources_fingerprint(session, matter_id) == compare_with[1].sources_fingerprint:
        same_sources = check("same_sources", "passed", "Same custodians and sites as the preview.")
    else:
        same_sources = check("same_sources", "failed", "The custodians or sites changed since the preview. Preview "
                             "again, so the export matches what was reviewed.")

    counts = None
    blocked: str | None = None if previewed and same_sources else "export_not_previewed"
    checked_at = utcnow()
    if blocked:
        reason = "the query wasn't previewed" if not previewed else "the custodians or sites changed"
        check("counts_unchanged", "skipped", f"Not checked because {reason}.")
    else:
        preview_run, _ = current
        op = gateway.wait_for_operation(gateway.start_estimate(matter.purview_case_id, version.purview_search_id),
                                        label="export check")
        checked_at = utcnow()
        counts = counts_from_operation(op)
        before = preview_run.counts or {}
        changes = [f"{before.get(field, 0):,} → {counts[field]:,} {label}" for field, label in DRIFT
                   if before.get(field) != counts[field]]
        if changes:
            blocked = "export_counts_changed"
            check("counts_unchanged", "failed", f"Counts changed since the preview: {'; '.join(changes)}. Preview again, "
                  "or accept the change explicitly (it's logged).")
        else:
            check("counts_unchanged", "passed", f"Counts unchanged since the preview (re-checked {_when(checked_at)}).")

    return contract.ExportCheck(
        ready=blocked is None,
        blocked_code=blocked,
        version=version.version if version else None,
        previewed_version=latest[1].version if latest else None,
        previewed_at=latest[0].finished_at if latest else None,
        checked_at=checked_at,
        counts=counts,
        checks=checks,
    )
