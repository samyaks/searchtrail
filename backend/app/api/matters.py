"""Matters: list, create, details, edit (contract tag `matters`)."""
from __future__ import annotations

from typing import Annotated

from fastapi import APIRouter, Depends, Path
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from app.db import repositories
from app.db.models import MatterRow, UserRow
from app.db.session import get_session
from app.schemas import contract
from app.schemas import matters as convert

from .deps import current_user
from .errors import ApiError

router = APIRouter(tags=["matters"])

MatterId = Annotated[str, Path(alias="matterId", description="Matter ID (not the matter number)")]
DbSession = Annotated[Session, Depends(get_session)]
User = Annotated[UserRow, Depends(current_user)]


def errors(*statuses: int) -> dict[int | str, dict]:
    """Error responses for the OpenAPI document; each must also be in the contract."""
    return {status: {"model": contract.Error} for status in statuses}


def load_matter(session: Session, matter_id: str, *, for_update: bool = False) -> MatterRow:
    matter = repositories.get_matter(session, matter_id, for_update=for_update)
    if matter is None:
        raise ApiError(404, "not_found", "There is no such matter. It may have been removed, or the link is wrong.",
                       {"matter_id": matter_id})
    return matter


def _duplicate(matter_number: str) -> ApiError:
    return ApiError(409, "conflict", f"A matter with number {matter_number} already exists.",
                    {"matter_number": matter_number})


@router.get("/matters", response_model=contract.MatterList, operation_id="listMatters", responses=errors(401))
def list_matters(session: DbSession, user: User, stage: contract.MatterStage | None = None,
                 q: str | None = None) -> contract.MatterList:
    items = [convert.matter_summary(listing) for listing in repositories.list_matters(session, stage=stage, q=q)]
    return contract.MatterList(items=items, total=len(items))


@router.post("/matters", response_model=contract.Matter, status_code=201, operation_id="createMatter",
             responses=errors(400, 401, 409))
def create_matter(body: contract.MatterCreate, session: DbSession, user: User) -> contract.Matter:
    if repositories.matter_number_taken(session, body.matter_number):
        raise _duplicate(body.matter_number)
    matter = repositories.create_matter(session, matter_number=body.matter_number, name=body.name,
                                        type=body.type.value, description=body.description or "",
                                        created_by=user.id)
    repositories.append_log(session, matter.id, contract.LogAction.MATTER_CREATED, actor=user.display_name,
                            actor_email=user.email, summary=f"{matter.matter_number} · {matter.name}",
                            matter={"matter_number": matter.matter_number, "name": matter.name,
                                    "type": matter.type, "description": matter.description})
    try:
        session.commit()
    except IntegrityError:  # created by someone else between the check and the commit
        session.rollback()
        raise _duplicate(body.matter_number) from None
    return convert.matter(repositories.matter_detail(session, matter))


@router.get("/matters/{matterId}", response_model=contract.Matter, operation_id="getMatter",
            responses=errors(401, 404))
def get_matter(matter_id: MatterId, session: DbSession, user: User) -> contract.Matter:
    return convert.matter(repositories.matter_detail(session, load_matter(session, matter_id)))


@router.patch("/matters/{matterId}", response_model=contract.Matter, operation_id="updateMatter",
              responses=errors(400, 401, 404))
def update_matter(matter_id: MatterId, body: contract.MatterUpdate, session: DbSession, user: User) -> contract.Matter:
    matter = load_matter(session, matter_id, for_update=True)
    changes = repositories.update_matter(session, matter, body.model_dump(mode="json", exclude_none=True))
    if changes:
        repositories.append_log(session, matter.id, contract.LogAction.MATTER_UPDATED, actor=user.display_name,
                                actor_email=user.email, summary="Changed the " + " and ".join(changes),
                                changes=changes)
        session.commit()
    return convert.matter(repositories.matter_detail(session, matter))
