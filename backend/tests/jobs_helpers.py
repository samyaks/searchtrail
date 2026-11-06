"""Building blocks for the job tests: a matter with custodians and sites, query versions, and running
jobs against one dry-run "tenant" shared by every worker (as a real tenant is)."""
from __future__ import annotations

from sqlalchemy import select

from app.api.deps import DRY_RUN_USER
from app.db import repositories
from app.db.base import new_id
from app.db.models import CustodianRow, JobRow, MatterRow, QueryVersionRow, SiteRow
from app.jobs import queue
from app.jobs.worker import run_one
from searchtrail.audit import sha256_text
from searchtrail.gateway_dryrun import DryRunPurviewGateway

KQL_V1 = '("project falcon" OR invoic* OR kickback) AND (kind:email OR kind:docs)'
KQL_V2 = '("project falcon" OR invoic* OR kickback OR "side letter") AND (kind:email OR kind:docs)'


def tenant() -> DryRunPurviewGateway:
    return DryRunPurviewGateway(log=lambda _m: None)


def seed_matter(s) -> MatterRow:
    """M-2026-0142 with Alex (mailbox only) and Megan (mailbox, OneDrive and a linked site), plus a
    site without a custodian. Created by the dry-run user."""
    user, _ = repositories.ensure_user(s, **DRY_RUN_USER)
    matter = repositories.create_matter(s, matter_number="M-2026-0142", name="Project Falcon investigation",
                                        type="investigation", description="Supplier payments.", created_by=user.id)
    s.add_all([
        CustodianRow(id=new_id("cus"), matter_id=matter.id, user_object_id="obj-alex", display_name="Alex Wilber",
                     email="alex.wilber@contoso.com", onedrive=False),
        CustodianRow(id=new_id("cus"), matter_id=matter.id, user_object_id="obj-megan", display_name="Megan Bowen",
                     email="megan.bowen@contoso.com", sites=["https://contoso.sharepoint.com/sites/ProjectFalcon"]),
        SiteRow(id=new_id("site"), matter_id=matter.id, url="https://contoso.sharepoint.com/sites/Finance"),
    ])
    s.flush()
    return matter


def add_version(s, matter: MatterRow, kql: str = KQL_V1) -> QueryVersionRow:
    """What WS-B1's estimate endpoint will do: freeze the draft and the current sources as a version."""
    number = (matter.current_version or 0) + 1
    version = QueryVersionRow(id=new_id("qv"), matter_id=matter.id, version=number, criteria={"keywords": ["x"]},
                              kql=kql, kql_sha256=sha256_text(kql), methodology=["..."],
                              sources_fingerprint=repositories.sources_fingerprint(s, matter.id))
    s.add(version)
    matter.current_version = number
    s.flush()
    return version


def enqueue_estimate(s, version: QueryVersionRow) -> str:
    job = queue.enqueue(s, "estimate", matter_id=version.matter_id, payload={"query_version_id": version.id},
                        created_by=DRY_RUN_USER["id"])
    s.commit()
    return job.id


def run_all(sessions, gateway, worker: str = "w1") -> None:
    with sessions() as s:
        while run_one(s, worker, lambda _job: gateway):
            pass


def job(sessions, job_id: str) -> JobRow:
    with sessions() as s:
        return s.get(JobRow, job_id)


def custodian(s, email: str) -> CustodianRow:
    return s.scalars(select(CustodianRow).where(CustodianRow.email == email)).one()


def calls(gateway, method: str, suffix: str) -> list:
    return [c for c in gateway.transport.calls if c[0] == method and c[1].split("?")[0].endswith(suffix)]


def writes(gateway) -> list:
    return [c for c in gateway.transport.calls if c[0] != "GET"]
