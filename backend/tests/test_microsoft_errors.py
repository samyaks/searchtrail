"""app.microsoft.errors.classify, the two layers that wrap it, and the import order of app.microsoft."""
from __future__ import annotations

import subprocess
import sys

import pytest
import requests
from jobs_helpers import add_version, enqueue_estimate, job, run_all, seed_matter, tenant
from sqlalchemy import select

from app.api.errors import ApiError
from app.api.graph import graph_errors
from app.db.models import RunRow
from app.jobs import steps
from app.microsoft.errors import Failure, classify
from searchtrail.graph import GraphError, OperationFailed


@pytest.mark.parametrize("error,expected", [
    (GraphError(429, "GET", "u", ""), ("graph_throttled", 429, True)),
    (GraphError(500, "GET", "u", ""), ("purview_operation_failed", 502, True)),
    (GraphError(503, "GET", "u", ""), ("purview_operation_failed", 502, True)),
    (GraphError(401, "GET", "u", ""), ("session_expired", 401, False)),
    (GraphError(403, "GET", "u", ""), ("purview_permission_missing", 403, False)),
    (GraphError(404, "GET", "u", ""), ("purview_operation_failed", 502, False)),
    (GraphError(400, "POST", "u", ""), ("purview_operation_failed", 502, False)),
    (OperationFailed({"id": "op-1", "status": "failed"}), ("purview_operation_failed", 502, False)),
    (requests.ConnectionError("down"), ("purview_operation_failed", 502, True)),
    (requests.Timeout("slow"), ("purview_operation_failed", 502, True)),
])
def test_classify(error, expected):
    failure = classify(error)
    assert isinstance(failure, Failure)
    assert (failure.code, failure.http_status, failure.transient) == expected


@pytest.mark.parametrize("error", [KeyError("x"), ValueError("y"), RuntimeError("z")])
def test_other_exceptions_are_not_microsoft_failures(error):
    assert classify(error) is None


def test_the_api_adds_a_retry_hint_only_to_failures_that_can_pass():
    for status, hint in ((429, True), (503, True), (403, False), (401, False)):
        with pytest.raises(ApiError) as caught, graph_errors():
            raise GraphError(status, "GET", "u", "")
        assert caught.value.message.endswith("Try again shortly.") is hint
    with pytest.raises(KeyError), graph_errors():  # not Microsoft's: untouched
        raise KeyError("x")


# -- the same mapping in the jobs -------------------------------------------------------------------------
@pytest.fixture(autouse=True)
def no_waiting(monkeypatch):
    monkeypatch.setattr(steps, "sleep", lambda _s: None)


def test_an_expired_microsoft_token_ends_a_job_as_session_expired_not_permissions(sessions, monkeypatch):
    gw = tenant()
    with sessions() as s:
        job_id = enqueue_estimate(s, add_version(s, seed_matter(s)))
    monkeypatch.setattr(gw, "get_operation", lambda _u: (_ for _ in ()).throw(GraphError(401, "GET", "u", "")))
    run_all(sessions, gw)

    failed = job(sessions, job_id)
    assert failed.status == "failed" and failed.error["code"] == "session_expired" and failed.attempts == 1
    assert "Sign in again" in failed.error["message"]
    with sessions() as s:
        assert s.scalars(select(RunRow)).one().status == "failed"


# -- layering ------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("module", [
    "app.microsoft.errors", "app.microsoft", "app.microsoft.directory", "app.microsoft.cloud", "app.microsoft.deps",
    "app.api.graph", "app.api.labels", "app.jobs.steps", "app.jobs.worker",
])
def test_every_microsoft_module_imports_first_without_a_cycle(module):
    """Imported alone in a fresh interpreter: the order the app happens to use hides cycles."""
    result = subprocess.run([sys.executable, "-c", f"import {module}"], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-600:]


def test_app_microsoft_never_imports_the_api_or_the_jobs():
    code = ("import sys, app.microsoft.errors, app.microsoft.directory, app.microsoft.cloud, app.microsoft.deps; "
            "bad = sorted(m for m in sys.modules if m.startswith(('app.api', 'app.jobs'))); print(bad)")
    result = subprocess.run([sys.executable, "-c", code], capture_output=True, text=True, timeout=60)
    assert result.returncode == 0, result.stderr[-600:]
    assert result.stdout.strip() == "[]"
