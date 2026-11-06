"""Dependencies shared by the routers.

`current_user` is a stub until WS-C's sign-in lands (docs/agents/C-microsoft-signin-and-graph.md):
in dry run every request acts as the fixed sample user below; otherwise it refuses with
401 session_expired, because there is no way to sign in yet. WS-C replaces the body, keeping the
name and the return type (a UserRow), so routes don't change.
"""
from __future__ import annotations

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.models import UserRow
from app.db.session import get_session
from app.settings import AppSettings, get_settings

from .errors import ApiError

# The dry-run user, matching the contract's /me example.
DRY_RUN_USER = {
    "id": "usr_dana",
    "entra_object_id": "00000000-0000-4000-8000-0000000da7a0",
    "tenant_id": "6f1d2c3b-0000-4000-8000-000000000001",
    "email": "dana.whitfield@contoso.com",
    "display_name": "Dana Whitfield",
}


def current_user(session: Session = Depends(get_session), settings: AppSettings = Depends(get_settings)) -> UserRow:
    if not settings.dry_run:
        raise ApiError(401, "session_expired", "Sign-in with Microsoft isn't available in this build yet. "
                       "Run SearchTrail in dry-run mode (SEARCHTRAIL_DRY_RUN=1).")
    user, changed = repositories.ensure_user(session, **DRY_RUN_USER)
    if changed:
        session.commit()  # keep a new user even when the request itself only reads
    return user
