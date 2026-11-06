"""API routers, one module per resource, all mounted under /api/v1 (see contracts/openapi.yaml).

WS-B1 owns this package. To add a resource, write `app/api/<resource>.py` with a `router` and add
the module to ROUTERS. WS-C adds `me`, `labels` and `directory` here (then `auth` and `setup`), with
a PR note; see docs/PHASE1_PLAN.md.
"""
from fastapi import APIRouter

from . import health, matters

ROUTERS = (
    health,
    matters,
)

api_router = APIRouter(prefix="/api/v1")
for module in ROUTERS:
    api_router.include_router(module.router)
