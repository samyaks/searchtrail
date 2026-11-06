from __future__ import annotations

import secrets
from datetime import UTC, datetime

from sqlalchemy import JSON, MetaData
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import DeclarativeBase

# Stable constraint names, so Alembic migrations are predictable.
NAMING = {
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    "fk": "fk_%(table_name)s_%(column_0_name)s_%(referred_table_name)s",
    "pk": "pk_%(table_name)s",
}

# JSONB on Postgres, plain JSON elsewhere (SQLite in unit tests).
JsonType = JSON().with_variant(JSONB(), "postgresql")


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING)


def utcnow() -> datetime:
    return datetime.now(UTC)


def new_id(prefix: str) -> str:
    """Opaque IDs like mat_3f9c0a1b2c4d5e6f: readable in logs, not guessable, sortable enough."""
    return f"{prefix}_{secrets.token_hex(8)}"
