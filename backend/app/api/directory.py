"""Find people to add as custodians (contract operation searchDirectoryUsers). Added by WS-C."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Query

from app.db.models import UserRow
from app.microsoft.deps import purview_gateway
from app.microsoft.directory import directory_users
from app.microsoft.errors import graph_errors
from app.schemas import contract
from searchtrail.gateway import PurviewGateway

from .deps import current_user
from .matters import errors

router = APIRouter(tags=["directory"])


@router.get("/directory/users", response_model=contract.DirectoryUserList, operation_id="searchDirectoryUsers",
            responses=errors(401, 429))
def search_directory_users(
    user: Annotated[UserRow, Depends(current_user)],
    gateway: Annotated[PurviewGateway, Depends(purview_gateway)],
    q: Annotated[str, Query(min_length=2, description="At least two characters")],
) -> contract.DirectoryUserList:
    query = q.strip()
    if len(query) < 2:  # "  a" passes min_length but is one character
        return contract.DirectoryUserList(items=[])
    with graph_errors():
        people = gateway.search_users(query)
    return contract.DirectoryUserList(items=directory_users(people))
