"""API routers, one module per resource, all mounted under /api/v1 (see contracts/openapi.yaml).

Phase 0 has /health only. WS-B1 adds the resource routers; WS-C adds auth, /me and /setup.
"""
from fastapi import APIRouter

from . import health

api_router = APIRouter(prefix="/api/v1")
api_router.include_router(health.router)
