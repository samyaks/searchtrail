"""People who use SearchTrail (rows in `users`). WS-C upserts them on sign-in."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..base import new_id
from ..models import UserRow


def ensure_user(session: Session, *, entra_object_id: str, tenant_id: str, email: str, display_name: str,
                id: str | None = None) -> tuple[UserRow, bool]:
    """Find the user by Entra object ID, or create them; keep the email and display name current.
    Returns (user, changed): `changed` is True when a row was written, so the caller knows whether
    there's anything to commit. Flushes, never commits. `id` fixes a new row's ID (the dry-run user
    is always `usr_dana`)."""
    query = select(UserRow).where(UserRow.entra_object_id == entra_object_id)
    user = session.scalars(query).one_or_none()
    if user is None:
        try:
            with session.begin_nested():  # a savepoint: losing a race undoes only this insert
                user = UserRow(id=id or new_id("usr"), entra_object_id=entra_object_id, tenant_id=tenant_id,
                               email=email, display_name=display_name)
                session.add(user)
            return user, True
        except IntegrityError:  # someone else created them first
            user = session.scalars(query).one_or_none()
            if user is None:  # the clash was on something else, such as a fixed `id` already in use
                raise
    if (user.email, user.display_name) != (email, display_name):
        user.email, user.display_name = email, display_name
        session.flush()
        return user, True
    return user, False
