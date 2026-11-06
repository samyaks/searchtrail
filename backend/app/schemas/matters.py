"""Conversions from matter rows (app/db/repositories) to the contract's models."""
from __future__ import annotations

from app.db.models import CustodianRow, HoldRow, UserRow
from app.db.repositories.matters import MatterDetail, MatterListing, as_utc

from . import contract


def initials(display_name: str) -> str:
    """'Alex Wilber' -> 'AW', 'Cher' -> 'C'."""
    words = display_name.split()
    if not words:
        return "?"
    return (words[0][0] + (words[-1][0] if len(words) > 1 else "")).upper()


def user_ref(user: UserRow | None) -> contract.UserRef:
    if user is None:  # created outside the API; every matter the API creates has an owner
        return contract.UserRef(id="", display_name="Unknown")
    return contract.UserRef(id=user.id, display_name=user.display_name)


def hold(row: HoldRow | None) -> contract.Hold:
    if row is None:
        return contract.Hold(status=contract.HoldStatus.OFF, since=None)
    return contract.Hold(status=row.status, since=as_utc(row.since) if row.since else None)


def custodian(row: CustodianRow, hold_row: HoldRow | None) -> contract.Custodian:
    return contract.Custodian(
        user_id=row.user_object_id, display_name=row.display_name, email=row.email, department=row.department,
        initials=initials(row.display_name), mailbox=row.mailbox, onedrive=row.onedrive, sites=list(row.sites or []),
        hold=hold(hold_row),
    )


def matter_summary(listing: MatterListing) -> contract.MatterSummary:
    m, counts = listing.matter, listing.latest_counts
    return contract.MatterSummary(
        id=m.id,
        matter_number=m.matter_number,
        name=m.name,
        stage=m.stage,
        custodian_count=listing.custodian_count,
        current_version=m.current_version,
        latest_counts=contract.LatestCounts(items=counts["items"], partial_items=counts["partial_items"]) if counts else None,
        export_progress=listing.export_progress,
        last_activity_at=listing.last_activity_at,
        owner=user_ref(listing.owner),
    )


def matter(detail: MatterDetail) -> contract.Matter:
    m = detail.matter
    return contract.Matter(
        id=m.id,
        matter_number=m.matter_number,
        name=m.name,
        type=m.type,
        description=m.description,
        stage=m.stage,
        purview_case_id=m.purview_case_id,
        created_at=as_utc(m.created_at),
        created_by=user_ref(detail.owner),
        custodians=[custodian(c, h) for c, h in detail.custodians],
        sites=[contract.Site(id=s.id, url=s.url) for s in detail.sites],
        current_version=m.current_version,
        previewed_version=detail.previewed_version,
        last_previewed_at=detail.last_previewed_at,
        draft_changed=detail.draft_changed,
    )
