"""What Microsoft Graph raising means for an API caller (the contract's ErrorCodes)."""
from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

import requests

from app.api.errors import ApiError
from searchtrail.graph import GraphError


@contextmanager
def graph_errors() -> Iterator[None]:
    """Wrap gateway calls made inside a request:

      429, 5xx, no connection   429 graph_throttled / 502 purview_operation_failed: try again shortly
      401, 403                  403 purview_permission_missing: the user lacks a role or consent
      other 4xx                 502 purview_operation_failed

    (The jobs have their own, richer mapping in app/jobs/steps.py: they can retry later.)"""
    try:
        yield
    except GraphError as exc:
        details = {"status": exc.status}
        if exc.status == 429:
            raise ApiError(429, "graph_throttled", "Microsoft is limiting requests right now. Try again in a minute.",
                           details) from exc
        if exc.status in (401, 403):
            raise ApiError(403, "purview_permission_missing",
                           "Microsoft refused the request. Check that you have the eDiscovery Manager role in Purview "
                           "and that SearchTrail has been given the permissions it needs.", details) from exc
        raise ApiError(502, "purview_operation_failed", "Microsoft couldn't answer that request. Try again shortly.",
                       details) from exc
    except requests.RequestException as exc:
        raise ApiError(502, "purview_operation_failed", "SearchTrail couldn't reach Microsoft. Try again shortly.",
                       {"error": type(exc).__name__}) from exc
