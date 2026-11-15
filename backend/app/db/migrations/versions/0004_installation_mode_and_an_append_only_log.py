"""Installation mode, and a log that can't be changed

Adds `installation`: one row saying whether the database belongs to a dry-run or a live installation,
so SearchTrail refuses to serve it in the other mode (dry run has no sign-in).

On Postgres, a trigger refuses UPDATE, DELETE and TRUNCATE on audit_entries: log entries are appended,
never changed. Only the table's owner can drop the trigger.

Revision ID: 0004
Revises: 0003
"""
from __future__ import annotations

from collections.abc import Sequence

import sqlalchemy as sa
from alembic import op

revision: str = '0004'
down_revision: str | None = '0003'
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

APPEND_ONLY = """
CREATE OR REPLACE FUNCTION audit_entries_append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'audit_entries is append-only: log entries are never changed or deleted'
    USING ERRCODE = 'insufficient_privilege';
END $$;
CREATE TRIGGER audit_entries_append_only BEFORE UPDATE OR DELETE ON audit_entries
  FOR EACH ROW EXECUTE FUNCTION audit_entries_append_only();
CREATE TRIGGER audit_entries_no_truncate BEFORE TRUNCATE ON audit_entries
  FOR EACH STATEMENT EXECUTE FUNCTION audit_entries_append_only();
"""


def upgrade() -> None:
    op.create_table('installation',
    sa.Column('id', sa.Integer(), autoincrement=False, nullable=False),
    sa.Column('mode', sa.String(length=16), nullable=False),
    sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id', name=op.f('pk_installation'))
    )
    if op.get_bind().dialect.name == "postgresql":
        op.execute(APPEND_ONLY)


def downgrade() -> None:
    if op.get_bind().dialect.name == "postgresql":
        op.execute("DROP TRIGGER IF EXISTS audit_entries_no_truncate ON audit_entries")
        op.execute("DROP TRIGGER IF EXISTS audit_entries_append_only ON audit_entries")
        op.execute("DROP FUNCTION IF EXISTS audit_entries_append_only()")
    op.drop_table('installation')
