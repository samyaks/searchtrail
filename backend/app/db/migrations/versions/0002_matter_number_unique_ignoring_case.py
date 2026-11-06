"""Matter numbers are unique ignoring case

Replaces the case-sensitive unique constraint on matters.matter_number with a unique index on
lower(matter_number), so two requests racing to create M-1 and m-1 can't both succeed.

Revision ID: 0002
Revises: 0001
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0002'
down_revision: str | None = '0001'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.drop_constraint(op.f('uq_matters_matter_number'), 'matters', type_='unique')
    op.create_index('uq_matters_matter_number_lower', 'matters', [sa.text('lower(matter_number)')], unique=True)


def downgrade() -> None:
    op.drop_index('uq_matters_matter_number_lower', table_name='matters')
    op.create_unique_constraint(op.f('uq_matters_matter_number'), 'matters', ['matter_number'])
