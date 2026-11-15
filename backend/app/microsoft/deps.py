"""The FastAPI dependency routers use to reach Microsoft.

`purview_gateway` is the one place a request gets its PurviewGateway, so tests override it and WS-C can
later build the live gateway from the signed-in user's tokens without touching any route. WS-B1's
endpoints that call Purview (holds, exports/check) take it the same way."""
from __future__ import annotations

from typing import Annotated

from fastapi import Depends

from app.settings import AppSettings, get_settings
from searchtrail.gateway import PurviewGateway

from . import get_gateway


def purview_gateway(settings: Annotated[AppSettings, Depends(get_settings)]) -> PurviewGateway:
    return get_gateway(settings)
