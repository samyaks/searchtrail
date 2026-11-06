"""The `estimate` job: counts for one query version.

Payload: {"query_version_id": "..."} (WS-B1's POST /matters/{id}/estimates creates the version first).
Result: the contract's EstimateResult.

Steps (see steps.py): lock the matter, sync the case and search, create the run, start the estimate,
checkpoint {run_id, operation_url}; poll; finish the run and log it. A resumed job finds the checkpoint
and goes straight to polling, so Purview gets exactly one estimate request per job.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import select

from app.db import repositories
from app.db.models import MatterRow, QueryVersionRow, RunRow
from app.schemas import contract

from . import purview
from .handlers import JobContext, JobFailed, register
from .steps import actor_of, counts_from_operation, counts_summary, poll_operation


def load_version(ctx: JobContext) -> QueryVersionRow:
    version_id = (ctx.job.payload or {}).get("query_version_id")
    version = ctx.session.get(QueryVersionRow, version_id) if version_id else None
    if version is None or version.matter_id != ctx.job.matter_id:
        raise JobFailed("not_found", "The query version for this job no longer exists.", {"query_version_id": version_id})
    return version


def lock_matter(ctx: JobContext, matter_id: str) -> MatterRow:
    """Lock the matter while its case and search are changed and the operation started, so two jobs on
    one matter never interleave their Purview writes. The checkpoint's commit releases it, so the lock
    is never held while polling."""
    return ctx.session.scalars(select(MatterRow).where(MatterRow.id == matter_id).with_for_update()).one()


def result_of(run: RunRow, version: QueryVersionRow) -> dict[str, Any]:
    return contract.EstimateResult(version=version.version, estimated_at=run.finished_at, counts=run.counts).model_dump(mode="json")


@register("estimate")
def estimate(ctx: JobContext) -> dict[str, Any]:
    version = load_version(ctx)
    checkpoint = ctx.job.checkpoint or {}

    if "operation_url" not in checkpoint:
        matter = lock_matter(ctx, version.matter_id)
        synced = purview.prepare(ctx.session, ctx.gateway, matter, version)
        run = repositories.create_run(ctx.session, matter_id=version.matter_id, query_version_id=version.id, kind="estimate",
                                      created_by=ctx.job.created_by)
        url = ctx.gateway.start_estimate(synced.case_id, synced.search_id)
        checkpoint = {"step": "polling", "run_id": run.id, "operation_url": url,
                      "case_id": synced.case_id, "search_id": synced.search_id}
        ctx.heartbeat(progress=0.1, checkpoint=checkpoint)  # commits: the operation is now resumable

    run = ctx.session.get(RunRow, checkpoint["run_id"])
    if run.status == "succeeded":  # finished by an earlier attempt that died before marking the job done
        return result_of(run, version)

    try:
        op = poll_operation(ctx, checkpoint["operation_url"], progress=(0.1, 0.95), label="estimate")
    except JobFailed:
        repositories.finish_run(ctx.session, run, status="failed")
        ctx.session.commit()  # the worker rolls back before recording the failure; keep the run's outcome
        raise

    counts = counts_from_operation(op)
    repositories.finish_run(ctx.session, run, status="succeeded", counts=counts)
    actor, actor_email = actor_of(ctx)
    repositories.append_log(
        ctx.session, version.matter_id, contract.LogAction.ESTIMATE, actor=actor, actor_email=actor_email,
        summary=counts_summary(version.version, counts), version=version.version,
        kql=version.kql, kql_sha256=version.kql_sha256, sources_fingerprint=version.sources_fingerprint,
        case_id=checkpoint["case_id"], search_id=checkpoint["search_id"], counts=counts,
        partially_succeeded=op.get("status") == "partiallySucceeded",
    )
    return result_of(run, version)
