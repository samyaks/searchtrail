from __future__ import annotations

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.db.session import get_session
from app.schemas.contract import Health
from app.settings import AppSettings, get_settings
from searchtrail import __version__

router = APIRouter(tags=["system"])


@router.get("/health", response_model=Health, operation_id="getHealth", responses={503: {"model": Health}})
def get_health(session: Session = Depends(get_session), settings: AppSettings = Depends(get_settings)):
    try:
        session.execute(text("SELECT 1"))
        database = "ok"
    except Exception:  # noqa: BLE001 - any failure means the database isn't usable
        database = "unreachable"
    body = Health(status="ok" if database == "ok" else "degraded", version=__version__, database=database,
                  dry_run=settings.dry_run)
    return JSONResponse(body.model_dump(mode="json"), status_code=200 if database == "ok" else 503)
