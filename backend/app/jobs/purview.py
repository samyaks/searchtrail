"""Bringing a matter's Purview case and search in line with the database, for the jobs.

The same code as the CLI (searchtrail.workflow.sync_purview); only where the IDs are kept differs:
`matters.purview_state` instead of state.json, copied onto the rows that show them (the matter's
case ID, each custodian's Purview IDs, the version's search ID).
"""
from __future__ import annotations

import copy

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.models import CustodianRow, MatterRow, QueryVersionRow, SiteRow
from searchtrail.gateway import PurviewGateway
from searchtrail.workflow import CustodianSources, PurviewTarget, Synced, sync_purview

from .handlers import JobFailed


def included_sources(custodian: CustodianRow) -> str:
    """Graph's includedSources flags for a custodian's toggles: mailbox (mail, Teams chats), site (OneDrive)."""
    return ", ".join(flag for flag, on in (("mailbox", custodian.mailbox), ("site", custodian.onedrive)) if on)


def prepare(session: Session, gateway: PurviewGateway, matter: MatterRow, version: QueryVersionRow) -> Synced:
    """Make the case and search match the version's query and the matter's sources, and record the
    Purview IDs on the rows (flushed, not committed).

    Refuses (JobFailed `conflict`) if the custodians or sites changed since the version was created:
    the counts would describe sources the version doesn't record. Nothing is sent to Purview then.
    """
    if repositories.sources_fingerprint(session, matter.id) != version.sources_fingerprint:
        raise JobFailed("conflict", "The custodians or sites changed after this was requested. Run it again so the "
                        "results match the matter's current sources.", {"version": version.version})
    custodians = session.scalars(select(CustodianRow).where(CustodianRow.matter_id == matter.id)
                                 .order_by(CustodianRow.created_at, CustodianRow.id)).all()
    sites = session.scalars(select(SiteRow.url).where(SiteRow.matter_id == matter.id)
                            .order_by(SiteRow.created_at, SiteRow.id)).all()
    target = PurviewTarget(
        matter_number=matter.matter_number,
        case_name=f"{matter.matter_number} {matter.name}",
        description=matter.description,
        custodians=[CustodianSources(c.email, list(c.sites or []), included_sources(c)) for c in custodians],
        additional_sites=list(sites),
        kql=version.kql,
    )
    state = copy.deepcopy(matter.purview_state or {})
    synced = sync_purview(gateway, state, target)

    matter.purview_state = state  # a new object, so the JSON column is written
    matter.purview_case_id = synced.case_id
    for custodian in custodians:
        entry = state["custodians"][custodian.email.lower()]
        custodian.purview_custodian_id = entry["custodian_id"]
        custodian.purview_user_source_id = entry.get("user_source_id") if included_sources(custodian) else None
    version.purview_search_id = synced.search_id
    session.flush()
    return synced
