"""Matters, and the facts the Matters list and the matter header show about them."""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session

from searchtrail.audit import canonical, sha256_text

from ..base import new_id
from ..models import (
    AuditEntryRow,
    CriteriaDraftRow,
    CustodianRow,
    ExportRow,
    HoldRow,
    MatterRow,
    QueryVersionRow,
    RunRow,
    SiteRow,
    UserRow,
)

EDITABLE = ("name", "type", "description")


def get_matter(session: Session, matter_id: str, *, for_update: bool = False) -> MatterRow | None:
    query = select(MatterRow).where(MatterRow.id == matter_id)
    if for_update:
        query = query.with_for_update()
    return session.scalars(query).one_or_none()


def matter_number_taken(session: Session, matter_number: str) -> bool:
    """Matter numbers are unique ignoring case, so M-1 and m-1 can't both exist."""
    query = select(func.count()).select_from(MatterRow).where(func.lower(MatterRow.matter_number) == matter_number.lower())
    return session.scalar(query) > 0


def create_matter(session: Session, *, matter_number: str, name: str, type: str, description: str,
                  created_by: str | None) -> MatterRow:
    matter = MatterRow(id=new_id("mat"), matter_number=matter_number, name=name, type=type,
                       description=description, stage="scoping", created_by=created_by)
    session.add(matter)
    session.flush()
    return matter


def update_matter(session: Session, matter: MatterRow, values: dict[str, Any]) -> dict[str, dict[str, Any]]:
    """Apply the given editable fields; return what changed as {field: {"from": old, "to": new}}."""
    changes = {}
    for field in EDITABLE:
        if field in values and getattr(matter, field) != values[field]:
            changes[field] = {"from": getattr(matter, field), "to": values[field]}
            setattr(matter, field, values[field])
    if changes:
        session.flush()
    return changes


def sources_fingerprint(session: Session, matter_id: str) -> str:
    """SHA-256 of who and where the matter searches: each custodian (email, mailbox, OneDrive, linked
    sites) and the sites without a custodian. A query version stores it when it's created, and an export
    is allowed only if the preview's fingerprint still matches."""
    custodians = session.scalars(select(CustodianRow).where(CustodianRow.matter_id == matter_id)).all()
    sites = session.scalars(select(SiteRow.url).where(SiteRow.matter_id == matter_id)).all()
    return fingerprint(custodians, sites)


def fingerprint(custodians: Iterable[CustodianRow], site_urls: Iterable[str]) -> str:
    """sources_fingerprint for rows already loaded."""
    return sha256_text(canonical({
        "custodians": sorted([c.email.lower(), bool(c.mailbox), bool(c.onedrive), sorted(c.sites or [])]
                             for c in custodians),
        "sites": sorted(site_urls),
    }))


def draft_changed(session: Session, matter: MatterRow, *, sources: str | None = None) -> bool:
    """True when the draft criteria or the sources differ from the current query version. False before
    the first estimate: there is nothing to compare with yet. `sources` is the matter's current
    fingerprint, if the caller already has it."""
    if matter.current_version is None:
        return False
    version = session.scalars(select(QueryVersionRow).where(
        QueryVersionRow.matter_id == matter.id, QueryVersionRow.version == matter.current_version)).one_or_none()
    if version is None:
        return False
    draft = session.get(CriteriaDraftRow, matter.id)
    if draft is not None and canonical(draft.criteria) != canonical(version.criteria):
        return True
    return (sources or sources_fingerprint(session, matter.id)) != version.sources_fingerprint


# -- the Matters list ------------------------------------------------------------------------------
@dataclass
class MatterListing:
    matter: MatterRow
    owner: UserRow | None
    custodian_count: int
    latest_counts: dict[str, Any] | None  # contract Counts of the current version's latest finished run
    export_progress: float | None
    last_activity_at: datetime


def list_matters(session: Session, *, stage: str | None = None, q: str | None = None) -> list[MatterListing]:
    """Matters with their stage and latest counts, most recent activity first. `q` matches the matter
    number or name, ignoring case. A fixed number of queries, however many matters there are."""
    query = select(MatterRow, UserRow).outerjoin(UserRow, UserRow.id == MatterRow.created_by)
    if stage:
        query = query.where(MatterRow.stage == stage)
    if q and q.strip():
        pattern = "%" + q.strip().lower().replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_") + "%"
        query = query.where(or_(func.lower(MatterRow.matter_number).like(pattern, escape="\\"),
                                func.lower(MatterRow.name).like(pattern, escape="\\")))
    rows = session.execute(query).all()
    if not rows:
        return []
    ids = [matter.id for matter, _ in rows]

    custodians = dict(session.execute(
        select(CustodianRow.matter_id, func.count()).where(CustodianRow.matter_id.in_(ids)).group_by(CustodianRow.matter_id)
    ).all())
    activity = dict(session.execute(
        select(AuditEntryRow.matter_id, func.max(AuditEntryRow.ts))
        .where(AuditEntryRow.matter_id.in_(ids)).group_by(AuditEntryRow.matter_id)
    ).all())
    counts = _latest_counts(session, [matter.id for matter, _ in rows if matter.current_version is not None])
    progress = _export_progress(session, [matter.id for matter, _ in rows if matter.stage == "exporting"])

    listings = [
        MatterListing(matter=matter, owner=owner, custodian_count=custodians.get(matter.id, 0),
                      latest_counts=counts.get(matter.id), export_progress=progress.get(matter.id),
                      last_activity_at=activity.get(matter.id) or matter.updated_at)
        for matter, owner in rows
    ]
    # Log timestamps are to the second; newer matters first when activity ties.
    listings.sort(key=lambda listing: (listing.last_activity_at, listing.matter.created_at), reverse=True)
    return listings


def _latest_counts(session: Session, ids: list[str]) -> dict[str, dict[str, Any]]:
    """Counts of the latest succeeded estimate or preview of each matter's current version. Only the
    current version's runs are read, however many versions a matter has had."""
    if not ids:
        return {}
    runs = session.execute(
        select(RunRow.matter_id, RunRow.counts)
        .join(QueryVersionRow, QueryVersionRow.id == RunRow.query_version_id)
        .join(MatterRow, MatterRow.id == RunRow.matter_id)
        .where(RunRow.matter_id.in_(ids), QueryVersionRow.version == MatterRow.current_version,
               RunRow.status == "succeeded", RunRow.kind.in_(("estimate", "preview")))
        .order_by(RunRow.finished_at, RunRow.created_at)
    ).all()
    return {matter_id: counts for matter_id, counts in runs if counts}  # oldest first, so the latest wins


def _export_progress(session: Session, exporting: list[str]) -> dict[str, float]:
    if not exporting:
        return {}
    rows = session.execute(
        select(ExportRow.matter_id, ExportRow.progress)
        .where(ExportRow.matter_id.in_(exporting), ExportRow.status == "preparing")
        .order_by(ExportRow.started_at)
    ).all()
    return dict(rows)  # the latest export of each matter wins


# -- one matter ------------------------------------------------------------------------------------
@dataclass
class MatterDetail:
    matter: MatterRow
    owner: UserRow | None
    custodians: list[tuple[CustodianRow, HoldRow | None]]  # with each custodian's latest hold request
    sites: list[SiteRow]
    previewed_version: int | None
    last_previewed_at: datetime | None
    draft_changed: bool


def matter_detail(session: Session, matter: MatterRow) -> MatterDetail:
    custodians = session.scalars(
        select(CustodianRow).where(CustodianRow.matter_id == matter.id).order_by(CustodianRow.created_at, CustodianRow.id)
    ).all()
    holds: dict[str, HoldRow] = {}
    if custodians:
        for hold in session.scalars(
            select(HoldRow).where(HoldRow.custodian_id.in_([c.id for c in custodians])).order_by(HoldRow.requested_at)
        ):
            holds[hold.custodian_id] = hold  # oldest first, so the latest wins
    sites = session.scalars(select(SiteRow).where(SiteRow.matter_id == matter.id).order_by(SiteRow.created_at, SiteRow.id)).all()
    previewed = session.execute(
        select(QueryVersionRow.version, RunRow.finished_at)
        .join(QueryVersionRow, QueryVersionRow.id == RunRow.query_version_id)
        .where(RunRow.matter_id == matter.id, RunRow.kind == "preview", RunRow.status == "succeeded")
        .order_by(RunRow.finished_at.desc(), RunRow.created_at.desc())
        .limit(1)
    ).first()
    return MatterDetail(
        matter=matter,
        owner=session.get(UserRow, matter.created_by) if matter.created_by else None,
        custodians=[(c, holds.get(c.id)) for c in custodians],
        sites=list(sites),
        previewed_version=previewed.version if previewed else None,
        last_previewed_at=previewed.finished_at if previewed else None,
        draft_changed=draft_changed(session, matter, sources=fingerprint(custodians, [s.url for s in sites])),
    )
