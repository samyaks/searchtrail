"""Every error response uses the contract's Error shape: {code, message, details}."""
from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse
from starlette.exceptions import HTTPException as StarletteHTTPException

from app.schemas.contract import ErrorCode


class ApiError(Exception):
    """Raise from a route to return an Error body. `code` must be one of the contract's ErrorCode values."""

    def __init__(self, status: int, code: ErrorCode | str, message: str, details: dict[str, Any] | None = None):
        super().__init__(message)
        self.status = status
        self.code = ErrorCode(code)
        self.message = message
        self.details = details or {}


def error_body(code: ErrorCode | str, message: str, details: dict[str, Any] | None = None) -> dict:
    return {"code": ErrorCode(code).value, "message": message, "details": details or {}}


_STATUS_CODES = {401: ErrorCode.SESSION_EXPIRED, 404: ErrorCode.NOT_FOUND, 409: ErrorCode.CONFLICT}


def install_error_handlers(app: FastAPI, headers: Mapping[str, str]) -> None:
    """`headers` go on the response to an unexpected error, which Starlette sends from outside every
    middleware (so the app's security-headers middleware never sees it)."""

    @app.exception_handler(ApiError)
    async def _api_error(_request: Request, exc: ApiError) -> JSONResponse:
        return JSONResponse(error_body(exc.code, exc.message, exc.details), status_code=exc.status)

    @app.exception_handler(StarletteHTTPException)
    async def _http_error(_request: Request, exc: StarletteHTTPException) -> JSONResponse:
        code = _STATUS_CODES.get(exc.status_code, ErrorCode.INTERNAL_ERROR if exc.status_code >= 500 else ErrorCode.VALIDATION_FAILED)
        return JSONResponse(error_body(code, str(exc.detail)), status_code=exc.status_code)

    @app.exception_handler(RequestValidationError)
    async def _validation_error(_request: Request, exc: RequestValidationError) -> JSONResponse:
        errors = [{"loc": list(e.get("loc", [])), "msg": e.get("msg")} for e in exc.errors()]
        return JSONResponse(error_body(ErrorCode.VALIDATION_FAILED, "The request is not valid.", {"errors": errors}),
                            status_code=400)

    @app.exception_handler(Exception)
    async def _unexpected(_request: Request, _exc: Exception) -> JSONResponse:
        # Starlette logs the exception after sending this; the body says nothing about it.
        return JSONResponse(error_body(ErrorCode.INTERNAL_ERROR, "Something went wrong on SearchTrail's side. It has "
                                       "been logged. Try again; if it keeps happening, tell your administrator."),
                            status_code=500, headers=dict(headers))
