"""People who use SearchTrail (rows in `users`). WS-C upserts them on sign-in."""
from __future__ import annotations

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from ..base import new_id
from ..models import UserRow


def ensure_user(session: Session, *, entra_object_id: str, tenant_id: str, email: str, display_name: str,
                id: str | None = None) -> UserRow:
    """Find the user by Entra object ID, or create them (flushed, not committed). Keeps the email and
    display name current. `id` fixes the new row's ID (the dry-run user is always `usr_dana`)."""
    query = select(UserRow).where(UserRow.entra_object_id == entra_object_id)
    user = session.scalars(query).one_or_none()
    if user is None:
        user = UserRow(id=id or new_id("usr"), entra_object_id=entra_object_id, tenant_id=tenant_id,
                       email=email, display_name=display_name)
        session.add(user)
        try:
            session.flush()
        except IntegrityError:  # another request created them first
            session.rollback()
            user = session.scalars(query).one()
    elif (user.email, user.display_name) != (email, display_name):
        user.email, user.display_name = email, display_name
        session.flush()
    return user
