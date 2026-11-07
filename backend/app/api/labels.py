"""Sensitivity labels with their sublabels (contract operation listLabels). Added by WS-C."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends

from app.db.models import UserRow
from app.microsoft.deps import purview_gateway
from app.microsoft.directory import label_tree
from app.schemas import contract
from searchtrail.gateway import PurviewGateway

from .deps import current_user
from .graph import graph_errors
from .matters import errors

router = APIRouter(tags=["criteria"])


@router.get("/labels", response_model=contract.LabelList, operation_id="listLabels", responses=errors(401, 403))
def list_labels(user: Annotated[UserRow, Depends(current_user)],
                gateway: Annotated[PurviewGateway, Depends(purview_gateway)]) -> contract.LabelList:
    with graph_errors():
        items = gateway.list_labels()
    return contract.LabelList(items=label_tree(items))
