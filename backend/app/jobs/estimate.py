"""The `estimate` job: counts for one query version.

Payload: {"query_version_id": "..."} (WS-B1's POST /matters/{id}/estimates creates the version first).
Result: the contract's EstimateResult.

Steps (see steps.py), each committed before the next, so a run after a retry or a dead worker picks up
where the last one stopped:
  1. lock the matter, sync the case, sources and the version's search, create the run
     -> checkpoint {run_id, case_id, search_id}
  2. start the estimate -> checkpoint + operation_url
  3. poll until Purview is done (the worker runs other jobs in between), finish the run, log it
Purview gets one estimate request per job, unless a worker dies between starting it and the checkpoint.
"""
from __future__ import annotations

from typing import Any

from sqlalchemy import text

from app.db import repositories
from app.db.models import MatterRow, QueryVersionRow, RunRow
from app.schemas import contract

from . import purview
from .handlers import JobContext, JobFailed, register
from .steps import actor_of, counts_from_operation, counts_summary, poll_operation, purview_errors


def load_version(ctx: JobContext) -> QueryVersionRow:
    version_id = (ctx.job.payload or {}).get("query_version_id")
    version = ctx.session.get(QueryVersionRow, version_id) if version_id else None
    if version is None or version.matter_id != ctx.job.matter_id:
        raise JobFailed("not_found", "The query version for this job no longer exists.", {"query_version_id": version_id})
    return version


def lock_matter(ctx: JobContext, matter_id: str) -> MatterRow:
    """Make this the only job syncing the matter's case and sources, until the next commit (the
    checkpoint's), so two jobs on one matter never both create the same custodian or source.

    A Postgres advisory lock, not a lock on the matter's row: syncing makes a dozen Graph calls, and a
    row lock would stop B1's edits and every log append for the whole matter meanwhile. Other sessions
    still read and write the matter freely; only other jobs wait. (SQLite, used in unit tests, has one
    writer at a time anyway.) The matter is read after the lock is taken, so it has what the last job
    holding the lock saved."""
    if ctx.session.get_bind().dialect.name == "postgresql":
        ctx.session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:key, 0))"), {"key": f"matter:{matter_id}"})
    return ctx.session.get(MatterRow, matter_id, populate_existing=True)


def result_of(run: RunRow, version: QueryVersionRow) -> dict[str, Any]:
    return contract.EstimateResult(version=version.version, estimated_at=run.finished_at, counts=run.counts).model_dump(mode="json")


@register("estimate")
def estimate(ctx: JobContext) -> dict[str, Any]:
    version = load_version(ctx)
    checkpoint = dict(ctx.job.checkpoint or {})

    if "search_id" not in checkpoint:  # 1. the case, sources and this version's search
        matter = lock_matter(ctx, version.matter_id)
        with purview_errors(ctx):
            synced = purview.prepare(ctx.session, ctx.gateway, matter, version)
        run = repositories.create_run(ctx.session, matter_id=version.matter_id, query_version_id=version.id,
                                      kind="estimate", created_by=ctx.job.created_by)
        checkpoint = {"step": "starting", "run_id": run.id, "case_id": synced.case_id, "search_id": synced.search_id}
        ctx.heartbeat(progress=0.05, checkpoint=checkpoint)  # commits the IDs: a retry from here won't sync again

    run = ctx.session.get(RunRow, checkpoint["run_id"])
    if run.status == "succeeded":  # finished by an earlier run that died before marking the job done
        return result_of(run, version)
    if run.status == "failed":  # likewise, but it failed
        raise JobFailed("purview_operation_failed", "An earlier attempt at this estimate failed. Run it again.",
                        {"run_id": run.id})

    try:
        if "operation_url" not in checkpoint:  # 2. start the estimate
            with purview_errors(ctx):
                url = ctx.gateway.start_estimate(checkpoint["case_id"], checkpoint["search_id"])
            checkpoint = {**checkpoint, "step": "polling", "operation_url": url}
            ctx.heartbeat(progress=0.1, checkpoint=checkpoint)  # commits: the operation is now resumable
        op = poll_operation(ctx, progress=(0.1, 0.95), label="estimate")  # 3. JobWait until Purview is done
    except JobFailed:  # not JobRetry or JobWait: after those the job runs again, and resumes this run
        repositories.finish_run(ctx.session, run, status="failed")
        ctx.heartbeat()  # commits the run's outcome (the worker rolls back before recording the failure)
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
    return result_of(run, version)  # the worker commits all of this with the job's result, or none of it
