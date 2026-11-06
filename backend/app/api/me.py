"""The signed-in user, their tenant and Purview roles (contract operation getMe). Added by WS-C."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.db.models import UserRow
from app.microsoft import DRY_RUN_PURVIEW_ROLES, DRY_RUN_TENANT_NAME
from app.microsoft.cloud import cloud_for
from app.schemas import contract
from app.schemas.matters import initials
from app.settings import AppSettings, get_settings

from .deps import current_user
from .matters import errors

router = APIRouter(tags=["system"])


@router.get("/me", response_model=contract.Me, operation_id="getMe", responses=errors(401))
def get_me(user: Annotated[UserRow, Depends(current_user)],
           settings: Annotated[AppSettings, Depends(get_settings)]) -> contract.Me:
    """Dry run: the sample user and tenant, with the role a real eDiscovery manager has. Live: the roles
    found for the user in Purview (WS-C, with /setup/check)."""
    return contract.Me(
        user=contract.User(id=user.id, display_name=user.display_name, email=user.email,
                           initials=initials(user.display_name)),
        tenant=contract.Tenant(id=user.tenant_id, name=DRY_RUN_TENANT_NAME),
        purview_roles=list(DRY_RUN_PURVIEW_ROLES),
        cloud=cloud_for(settings.graph_base),
        dry_run=settings.dry_run,
    )
