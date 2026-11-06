"""The V1 data model (docs/V1_PLAN.md section 5.5). First migration: 0001_initial.

Conventions: string primary keys from new_id(); timestamps are timezone-aware UTC; JSON columns
hold structures that mirror the contract (criteria, counts, options). WS-B1 owns this file.
"""
from __future__ import annotations

from datetime import datetime
from typing import Any

from sqlalchemy import (
    BigInteger,
    Boolean,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    LargeBinary,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base, JsonType, utcnow

TZ = DateTime(timezone=True)


def _created() -> Mapped[datetime]:
    return mapped_column(TZ, default=utcnow, nullable=False)


# -- people, sessions, tokens ------------------------------------------------------------------
class UserRow(Base):
    __tablename__ = "users"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    entra_object_id: Mapped[str] = mapped_column(String(64), unique=True)
    tenant_id: Mapped[str] = mapped_column(String(64))
    email: Mapped[str] = mapped_column(String(320))
    display_name: Mapped[str] = mapped_column(String(200))
    created_at: Mapped[datetime] = _created()
    last_seen_at: Mapped[datetime | None] = mapped_column(TZ)


class SessionRow(Base):
    """A browser session. The cookie holds only the session ID; tokens stay in token_cache."""

    __tablename__ = "sessions"
    id: Mapped[str] = mapped_column(String(64), primary_key=True)
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), index=True)
    created_at: Mapped[datetime] = _created()
    expires_at: Mapped[datetime] = mapped_column(TZ)
    last_seen_at: Mapped[datetime | None] = mapped_column(TZ)
    user_agent: Mapped[str | None] = mapped_column(String(400))


class TokenCacheRow(Base):
    """MSAL token cache per user, encrypted at rest (WS-C). Never returned by the API."""

    __tablename__ = "token_cache"
    user_id: Mapped[str] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), primary_key=True)
    ciphertext: Mapped[bytes] = mapped_column(LargeBinary)
    key_id: Mapped[str] = mapped_column(String(64))
    updated_at: Mapped[datetime] = _created()


# -- matters and their sources -----------------------------------------------------------------
class MatterRow(Base):
    __tablename__ = "matters"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_number: Mapped[str] = mapped_column(String(64), unique=True)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(32))
    description: Mapped[str] = mapped_column(Text, default="")
    stage: Mapped[str] = mapped_column(String(16), default="scoping")
    purview_case_id: Mapped[str | None] = mapped_column(String(64))
    current_version: Mapped[int | None] = mapped_column(Integer)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _created()


class CustodianRow(Base):
    __tablename__ = "custodians"
    __table_args__ = (UniqueConstraint("matter_id", "user_object_id"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    user_object_id: Mapped[str] = mapped_column(String(64))
    display_name: Mapped[str] = mapped_column(String(200))
    email: Mapped[str] = mapped_column(String(320))
    department: Mapped[str | None] = mapped_column(String(200))
    mailbox: Mapped[bool] = mapped_column(Boolean, default=True)
    onedrive: Mapped[bool] = mapped_column(Boolean, default=True)
    sites: Mapped[list[str]] = mapped_column(JsonType, default=list)
    purview_custodian_id: Mapped[str | None] = mapped_column(String(64))
    purview_user_source_id: Mapped[str | None] = mapped_column(String(64))
    created_at: Mapped[datetime] = _created()


class SiteRow(Base):
    """A SharePoint site without a custodian."""

    __tablename__ = "sites"
    __table_args__ = (UniqueConstraint("matter_id", "url"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    url: Mapped[str] = mapped_column(String(2000))
    created_at: Mapped[datetime] = _created()


class HoldRow(Base):
    __tablename__ = "holds"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    custodian_id: Mapped[str] = mapped_column(ForeignKey("custodians.id", ondelete="CASCADE"), index=True)
    status: Mapped[str] = mapped_column(String(16))  # off | pending | on | releasing | failed
    requested_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    requested_at: Mapped[datetime] = _created()
    since: Mapped[datetime | None] = mapped_column(TZ)
    released_at: Mapped[datetime | None] = mapped_column(TZ)
    operation_url: Mapped[str | None] = mapped_column(Text)


# -- criteria and query versions ---------------------------------------------------------------
class CriteriaDraftRow(Base):
    __tablename__ = "criteria_drafts"
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), primary_key=True)
    criteria: Mapped[dict[str, Any]] = mapped_column(JsonType)
    based_on_version: Mapped[int | None] = mapped_column(Integer)
    updated_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    updated_at: Mapped[datetime] = _created()


class QueryVersionRow(Base):
    """A frozen version of the query, created when a changed draft is estimated."""

    __tablename__ = "query_versions"
    __table_args__ = (UniqueConstraint("matter_id", "version"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    version: Mapped[int] = mapped_column(Integer)
    criteria: Mapped[dict[str, Any]] = mapped_column(JsonType)
    kql: Mapped[str] = mapped_column(Text)
    kql_sha256: Mapped[str] = mapped_column(String(64))
    methodology: Mapped[list[str]] = mapped_column(JsonType)
    sources_fingerprint: Mapped[str] = mapped_column(String(64))
    purview_search_id: Mapped[str | None] = mapped_column(String(64))
    summary: Mapped[str] = mapped_column(Text, default="")
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()


class RunRow(Base):
    """An estimate, preview or term report of one query version."""

    __tablename__ = "runs"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    query_version_id: Mapped[str] = mapped_column(ForeignKey("query_versions.id"), index=True)
    kind: Mapped[str] = mapped_column(String(16))  # estimate | preview | term_report
    status: Mapped[str] = mapped_column(String(16))  # running | succeeded | failed
    counts: Mapped[dict[str, Any] | None] = mapped_column(JsonType)  # contract Counts
    result: Mapped[dict[str, Any] | None] = mapped_column(JsonType)  # breakdowns, term rows
    files: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)  # stored report files
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    finished_at: Mapped[datetime | None] = mapped_column(TZ)


class PreviewItemRow(Base):
    """One row of Purview's item report (metadata only)."""

    __tablename__ = "preview_items"
    __table_args__ = (
        Index("ix_preview_items_run_location", "run_id", "location"),
        Index("ix_preview_items_run_type", "run_id", "type"),
        Index("ix_preview_items_run_label", "run_id", "label"),
    )
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    run_id: Mapped[str] = mapped_column(ForeignKey("runs.id", ondelete="CASCADE"))
    item_id: Mapped[str] = mapped_column(String(400))
    title: Mapped[str] = mapped_column(Text, default="")
    location: Mapped[str] = mapped_column(String(400), default="")
    type: Mapped[str] = mapped_column(String(16))  # email | teams_chat | document | other
    date: Mapped[datetime | None] = mapped_column(TZ)
    label: Mapped[str | None] = mapped_column(String(400))
    size_bytes: Mapped[int | None] = mapped_column(BigInteger)
    encrypted: Mapped[bool] = mapped_column(Boolean, default=False)


# -- exports -------------------------------------------------------------------------------------
class ExportRow(Base):
    __tablename__ = "exports"
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    query_version_id: Mapped[str] = mapped_column(ForeignKey("query_versions.id"))
    name: Mapped[str] = mapped_column(String(300))
    status: Mapped[str] = mapped_column(String(16))  # preparing | ready | failed | expired
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    options: Mapped[dict[str, Any]] = mapped_column(JsonType)  # contract ExportOptions
    counts: Mapped[dict[str, Any]] = mapped_column(JsonType)
    changes_accepted: Mapped[bool] = mapped_column(Boolean, default=False)
    operation_url: Mapped[str | None] = mapped_column(Text)
    files: Mapped[list[dict[str, Any]]] = mapped_column(JsonType, default=list)
    expires_at: Mapped[datetime | None] = mapped_column(TZ)
    download_status: Mapped[str] = mapped_column(String(16), default="none")
    download_path: Mapped[str | None] = mapped_column(Text)
    download_finished_at: Mapped[datetime | None] = mapped_column(TZ)
    review_set_status: Mapped[str] = mapped_column(String(16), default="none")
    review_set_name: Mapped[str | None] = mapped_column(String(200))
    review_set_finished_at: Mapped[datetime | None] = mapped_column(TZ)
    started_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    started_at: Mapped[datetime] = _created()
    finished_at: Mapped[datetime | None] = mapped_column(TZ)


# -- jobs ------------------------------------------------------------------------------------------
class JobRow(Base):
    """A long action, claimed by the worker with SELECT ... FOR UPDATE SKIP LOCKED (see app/jobs)."""

    __tablename__ = "jobs"
    __table_args__ = (Index("ix_jobs_claim", "status", "run_after"),)
    id: Mapped[str] = mapped_column(String(40), primary_key=True)
    kind: Mapped[str] = mapped_column(String(16))  # estimate | preview | term_report | export | download | review_set
    status: Mapped[str] = mapped_column(String(16), default="queued")  # queued | running | succeeded | failed
    progress: Mapped[float] = mapped_column(Float, default=0.0)
    matter_id: Mapped[str | None] = mapped_column(ForeignKey("matters.id", ondelete="CASCADE"), index=True)
    payload: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    # Where a resumable job is up to, e.g. {"step": "polling", "operation_url": "..."}.
    checkpoint: Mapped[dict[str, Any]] = mapped_column(JsonType, default=dict)
    result: Mapped[dict[str, Any] | None] = mapped_column(JsonType)
    error: Mapped[dict[str, Any] | None] = mapped_column(JsonType)  # contract Error
    attempts: Mapped[int] = mapped_column(Integer, default=0)
    run_after: Mapped[datetime] = _created()
    locked_by: Mapped[str | None] = mapped_column(String(100))
    heartbeat_at: Mapped[datetime | None] = mapped_column(TZ)
    created_by: Mapped[str | None] = mapped_column(ForeignKey("users.id"))
    created_at: Mapped[datetime] = _created()
    updated_at: Mapped[datetime] = _created()


# -- the log ---------------------------------------------------------------------------------------
class AuditEntryRow(Base):
    """One hash-chained log entry. `record` is exactly what audit.py hashes (seq, ts, fields, prev_hash);
    `hash` is SHA-256 of its canonical JSON. The other columns are copies for querying."""

    __tablename__ = "audit_entries"
    __table_args__ = (UniqueConstraint("matter_id", "seq"),)
    id: Mapped[int] = mapped_column(BigInteger().with_variant(Integer, "sqlite"), primary_key=True, autoincrement=True)
    matter_id: Mapped[str] = mapped_column(ForeignKey("matters.id", ondelete="RESTRICT"), index=True)
    seq: Mapped[int] = mapped_column(Integer)
    ts: Mapped[datetime] = mapped_column(TZ)
    action: Mapped[str] = mapped_column(String(32))
    actor: Mapped[str] = mapped_column(String(320))
    record: Mapped[dict[str, Any]] = mapped_column(JsonType)
    prev_hash: Mapped[str] = mapped_column(String(64))
    hash: Mapped[str] = mapped_column(String(64))
