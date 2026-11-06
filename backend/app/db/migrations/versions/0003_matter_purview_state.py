"""Matters keep the Purview IDs SearchTrail created for them

Adds matters.purview_state: the case, custodian, source and search IDs, in the same shape as the
CLI's state.json, so jobs reuse what exists instead of creating it again.

Revision ID: 0003
Revises: 0002
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision: str = '0003'
down_revision: str | None = '0002'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.add_column('matters', sa.Column('purview_state', sa.JSON().with_variant(postgresql.JSONB(astext_type=sa.Text()), 'postgresql'),
                                       server_default=sa.text("'{}'"), nullable=False))


def downgrade() -> None:
    op.drop_column('matters', 'purview_state')
