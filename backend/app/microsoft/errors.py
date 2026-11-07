"""What a failed Microsoft call means, in one place.

`classify` turns what the Graph client raises into a `Failure`: the contract's error code, a plain-English
message, and whether trying again later can help. The API (app/api/graph.py) turns that into an HTTP error
and the jobs (app/jobs/steps.py) into a retry or a failure, so the two can't drift apart.

This module depends on nothing in app.api or app.jobs: the layers above wrap it, not the other way round.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

import requests

from searchtrail.graph import GraphError, OperationFailed


@dataclass(frozen=True)
class Failure:
    code: str  # a contract ErrorCode
    message: str  # what the user is told, without a "try again" suffix: each layer adds its own
    http_status: int  # for an API response
    transient: bool  # trying again later can help (throttling, an outage, no connection)
    details: dict[str, Any] = field(default_factory=dict)


def classify(exc: BaseException) -> Failure | None:
    """The Failure for something a Microsoft call raised, or None if it isn't a Microsoft failure.

      429                          graph_throttled, transient
      5xx, no connection           purview_operation_failed, transient
      401                          session_expired: the user's Microsoft token is no longer valid
      403                          purview_permission_missing: the user lacks a role or consent
      other 4xx, failed operation  purview_operation_failed
    """
    if isinstance(exc, GraphError):
        details = {"status": exc.status}
        if exc.status == 429:
            return Failure("graph_throttled", "Microsoft is limiting requests right now.", 429, True, details)
        if exc.status >= 500:
            return Failure("purview_operation_failed", "Microsoft Purview had a problem.", 502, True, details)
        if exc.status == 401:
            return Failure("session_expired", "Your Microsoft sign-in is no longer valid. Sign in again to continue.",
                           401, False, details)
        if exc.status == 403:
            return Failure("purview_permission_missing",
                           "Microsoft refused the request. Check that you have the eDiscovery Manager role in Purview "
                           "and that SearchTrail has been given the permissions it needs.", 403, False, details)
        return Failure("purview_operation_failed", "Microsoft Purview rejected the request.", 502, False, details)
    if isinstance(exc, OperationFailed):
        return Failure("purview_operation_failed", "Purview couldn't finish the operation.", 502, False,
                       {"detail": str(exc)})
    if isinstance(exc, requests.RequestException):
        return Failure("purview_operation_failed", "SearchTrail couldn't reach Microsoft.", 502, True,
                       {"error": type(exc).__name__})
    return None
