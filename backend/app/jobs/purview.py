"""Bringing a matter's Purview case and a query version's search in line with the database, for the jobs.

The same code as the CLI for the case and sources (searchtrail.workflow.sync_sources); only where the IDs
are kept differs: `matters.purview_state` instead of state.json, copied onto the rows that show them
(the matter's case ID, each custodian's Purview IDs, the version's search ID).

Each query version gets a Purview search of its own (workflow.ensure_version_search), made once and
never changed, so work on one version (an export running for an hour) is never disturbed by another.
"""
from __future__ import annotations

import copy
import logging

from sqlalchemy import select
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.models import CustodianRow, MatterRow, QueryVersionRow, SiteRow
from searchtrail.gateway import PurviewGateway
from searchtrail.workflow import CustodianSources, PurviewTarget, Synced, ensure_version_search, sync_sources

from .handlers import JobFailed

log = logging.getLogger("searchtrail.jobs")


def included_sources(custodian: CustodianRow) -> str:
    """Graph's includedSources flags for a custodian's toggles: mailbox (mail, Teams chats), site (OneDrive)."""
    return ", ".join(flag for flag, on in (("mailbox", custodian.mailbox), ("site", custodian.onedrive)) if on)


def search_name(matter: MatterRow, version: QueryVersionRow) -> str:
    """The Purview search's display name for a query version: unique in the case, so a lost create is
    found again by name."""
    return f"{matter.matter_number} query v{version.version}"


def prepare(session: Session, gateway: PurviewGateway, matter: MatterRow, version: QueryVersionRow) -> Synced:
    """Make the case, sources and the version's search exist, and record the Purview IDs on the rows
    (flushed, not committed).

    Refuses (JobFailed `conflict`) if the custodians or sites changed since the version was created:
    the counts would describe sources the version doesn't record. Nothing is sent to Purview then.

    If the sync stops partway (Purview throttles, refuses, or the code fails), the IDs Purview handed out
    so far are committed before the error goes on, so the retry doesn't make them again. Call this before
    the job writes anything else in its transaction: that commit takes everything pending with it.
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
    try:
        sources = sync_sources(gateway, state, target)
        synced = ensure_version_search(gateway, state, sources.case_id, name=search_name(matter, version),
                                       kql=version.kql, source_urls=sources.source_urls,
                                       additional_sites=target.additional_sites)
    except Exception:
        _keep_state(session, matter, state)
        raise

    matter.purview_state = state  # a new object, so the JSON column is written
    matter.purview_case_id = synced.case_id
    for custodian in custodians:
        entry = state["custodians"][custodian.email.lower()]
        custodian.purview_custodian_id = entry["custodian_id"]
        custodian.purview_user_source_id = entry.get("user_source_id") if included_sources(custodian) else None
    version.purview_search_id = synced.search_id
    session.flush()
    return synced


def _keep_state(session: Session, matter: MatterRow, state: dict) -> None:
    """Commit the Purview IDs from a sync that stopped partway: they're facts about the tenant, and the
    worker rolls back before retrying. Ends the transaction, and with it the job's matter lock, which is
    fine: the job is stopping."""
    if state == (matter.purview_state or {}):
        return
    try:
        matter.purview_state = copy.deepcopy(state)
        session.commit()
    except Exception:  # noqa: BLE001 - the original error matters more; this one is logged
        session.rollback()
        log.exception("couldn't save matter %s's Purview IDs after a failed sync; a retry may create some again",
                      matter.id)
