"""FastAPI app factory. Run: uvicorn app.main:app (or `docker compose up` in deploy/)."""
from __future__ import annotations

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from app.api import api_router
from app.api.errors import install_error_handlers
from app.settings import AppSettings, get_settings
from searchtrail import __version__

# Baseline headers for API responses. WS-G owns the full set (CSP for the web app, HSTS behind TLS).
SECURITY_HEADERS = {
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
    "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
}


def create_app(settings: AppSettings | None = None) -> FastAPI:
    settings = settings or get_settings()
    app = FastAPI(
        title="SearchTrail API",
        version=__version__,
        docs_url="/api/docs",
        openapi_url="/api/openapi.json",
        redoc_url=None,
    )
    app.dependency_overrides[get_settings] = lambda: settings

    @app.middleware("http")
    async def security_headers(request: Request, call_next):
        response = await call_next(request)
        for name, value in SECURITY_HEADERS.items():
            response.headers.setdefault(name, value)
        return response

    if settings.cors_origins:
        app.add_middleware(CORSMiddleware, allow_origins=settings.cors_origins, allow_credentials=True,
                           allow_methods=["*"], allow_headers=["*"])
    install_error_handlers(app)
    app.include_router(api_router)
    return app


app = create_app()
