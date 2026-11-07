"""Microsoft failures inside a request, as the contract's errors. Added by WS-C."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from app.microsoft.errors import classify

from .errors import ApiError


@contextmanager
def graph_errors() -> Iterator[None]:
    """Wrap gateway calls made inside a request. What Graph raises becomes an ApiError with the status and
    code from app.microsoft.errors.classify (429 graph_throttled, 401 session_expired, 403
    purview_permission_missing, otherwise 502 purview_operation_failed). The jobs map the same failures
    in app/jobs/steps.py, where transient ones are retried."""
    try:
        yield
    except Exception as exc:
        failure = classify(exc)
        if failure is None:
            raise
        message = failure.message + (" Try again shortly." if failure.transient else "")
        raise ApiError(failure.http_status, failure.code, message, failure.details) from exc
