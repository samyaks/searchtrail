"""Who may open which matter: the one check every matter route goes through (docs/adr/0013-matter-access.md).

  dry run                          the sample user opens every matter (one simulated person, one tenant)
  live, no Purview case yet        only the person who created the matter
  live, with a Purview case        whoever Purview lets open the case: its members and eDiscovery
                                   Administrators. SearchTrail asks Purview with the person's own token
                                   and remembers the answer briefly. WS-C builds that question; until
                                   then the answer is no.

A matter the person may not open is "not found" (404), like one that doesn't exist, so the API never
confirms to someone outside a case that the matter exists.

Routes take `access: Access` and call access.matter(session, matter_id) instead of loading the matter
themselves; lists keep only what access.can_open allows.
"""
from __future__ import annotations

from collections.abc import Iterable
from dataclasses import dataclass
from typing import Annotated, TypeVar

from fastapi import Depends
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.models import MatterRow, UserRow
from app.settings import AppSettings, get_settings

from .deps import current_user
from .errors import ApiError

T = TypeVar("T")


@dataclass(frozen=True)
class MatterAccess:
    user: UserRow
    dry_run: bool

    def can_open(self, matter: MatterRow) -> bool:
        if self.dry_run:
            return True
        if matter.purview_case_id is None:
            return matter.created_by == self.user.id
        # WS-C: ask Purview whether the user's token can read the case (GET .../ediscoveryCases/{id}),
        # and cache the answer per user and case for a few minutes. Until then: no.
        return False

    def matter(self, session: Session, matter_id: str, *, for_update: bool = False) -> MatterRow:
        """The matter, or 404 if it doesn't exist or this person may not open it."""
        matter = repositories.get_matter(session, matter_id, for_update=for_update)
        if matter is None or not self.can_open(matter):
            raise ApiError(404, "not_found", "There is no such matter. It may have been removed, or the link is wrong.",
                           {"matter_id": matter_id})
        return matter

    def visible(self, items: Iterable[T], matter_of=lambda item: item.matter) -> list[T]:
        """The items (MatterListing by default) whose matter this person may open."""
        return [item for item in items if self.can_open(matter_of(item))]


def matter_access(user: UserRow = Depends(current_user), settings: AppSettings = Depends(get_settings)) -> MatterAccess:
    return MatterAccess(user, settings.dry_run)


Access = Annotated[MatterAccess, Depends(matter_access)]
