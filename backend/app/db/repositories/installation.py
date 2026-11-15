"""Which mode the database belongs to: dry run or live (the `installation` table).

The API (on every request, in current_user) and the worker (when it starts) refuse to use a database
recorded for the other mode. Dry run has no sign-in and acts for a sample user, so serving a live
database in dry run (a lost .env, a mistyped variable) would hand every matter to anyone who can reach
the API. The first use records the mode.
"""
from __future__ import annotations

from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..models import InstallationRow

DRY_RUN, LIVE = "dry_run", "live"


class ModeMismatch(RuntimeError):
    """The database was set up for the other mode."""


def check_mode(session: Session, *, dry_run: bool, record: bool = True) -> None:
    """Raise ModeMismatch if the database belongs to the other mode. With `record`, a database with no
    mode yet is marked as this one (committed: the only function here that commits, because the mark
    must stand whatever the caller does next)."""
    mode = DRY_RUN if dry_run else LIVE
    row = session.get(InstallationRow, 1)
    if row is None:
        if not record:
            return
        try:
            with session.begin_nested():
                session.add(InstallationRow(id=1, mode=mode))
            session.commit()
            return
        except IntegrityError:  # another process recorded it first
            session.rollback()
            row = session.get(InstallationRow, 1)
    if row.mode == mode:
        return
    if mode == DRY_RUN:
        raise ModeMismatch(
            "This database belongs to a live SearchTrail installation, but SearchTrail started in dry-run mode "
            "(SEARCHTRAIL_DRY_RUN=1). Dry run has no sign-in, so it never serves a live database. Turn dry run "
            "off, or point SEARCHTRAIL_DATABASE_URL at a dry-run database.")
    raise ModeMismatch(
        "This database was set up in dry-run mode: its matters point at a simulated tenant, not Microsoft 365. "
        "Use a new database for live mode (SEARCHTRAIL_DATABASE_URL), or turn dry run back on "
        "(SEARCHTRAIL_DRY_RUN=1).")
