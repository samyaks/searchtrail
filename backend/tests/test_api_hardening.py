"""The API's safety rails: the installation mode, who may open a matter, unexpected errors, the API docs
and CORS, and a log that can't be changed."""
from __future__ import annotations

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from app.api.access import MatterAccess
from app.api.deps import DRY_RUN_USER, current_user
from app.db import repositories
from app.db.models import InstallationRow, MatterRow, UserRow
from app.db.session import get_session
from app.jobs.worker import Worker
from app.main import create_app
from app.settings import AppSettings

FALCON = {"matter_number": "M-2026-0142", "name": "Project Falcon investigation", "type": "investigation"}


def make_client(sessions, *, raise_errors: bool = True, **settings) -> TestClient:
    app = create_app(AppSettings(**settings))

    def session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = session
    return TestClient(app, raise_server_exceptions=raise_errors)


def mode_of(sessions) -> str | None:
    with sessions() as s:
        row = s.get(InstallationRow, 1)
        return row.mode if row else None


# -- the installation mode -----------------------------------------------------------------------------
def test_the_first_request_records_the_mode(sessions):
    assert mode_of(sessions) is None
    assert make_client(sessions, dry_run=True).get("/api/v1/matters").status_code == 200
    assert mode_of(sessions) == "dry_run"


def test_a_live_database_is_never_served_in_dry_run(sessions):
    """A lost .env turns dry run on (no sign-in, everyone is the sample user) against a live database:
    every request is refused, and /health says so, so the deployment notices at once."""
    with sessions() as s:
        s.add(InstallationRow(id=1, mode="live"))
        s.commit()
    api = make_client(sessions, dry_run=True)
    r = api.get("/api/v1/matters")
    assert r.status_code == 500 and r.json()["code"] == "internal_error"
    assert "belongs to a live SearchTrail installation" in r.json()["message"]
    assert api.post("/api/v1/matters", json=FALCON).status_code == 500
    with sessions() as s:
        assert s.query(MatterRow).count() == 0 and s.query(UserRow).count() == 0  # not even the sample user
    health = api.get("/api/v1/health")
    assert health.status_code == 503 and health.json()["status"] == "degraded" and health.json()["database"] == "ok"


def test_a_dry_run_database_is_not_used_live(sessions):
    with sessions() as s:
        s.add(InstallationRow(id=1, mode="dry_run"))
        s.commit()
    r = make_client(sessions, dry_run=False).get("/api/v1/me")
    assert r.status_code == 500 and "set up in dry-run mode" in r.json()["message"]


def test_health_only_reads_the_mode(sessions):
    assert make_client(sessions, dry_run=True).get("/api/v1/health").status_code == 200
    assert mode_of(sessions) is None  # recorded by the first real use, not by a health probe


def test_the_worker_refuses_a_database_of_the_other_mode(sessions):
    with sessions() as s:
        s.add(InstallationRow(id=1, mode="live"))
        s.commit()
    worker = Worker(AppSettings(dry_run=True), sessions=sessions, gateway_for=lambda _j: None)
    with pytest.raises(repositories.ModeMismatch, match="live SearchTrail installation"):
        worker.loop(once=True)


def test_the_worker_exits_with_an_error_when_the_mode_is_wrong(sessions, monkeypatch, caplog):
    from app.jobs import worker as worker_module

    with sessions() as s:
        s.add(InstallationRow(id=1, mode="live"))
        s.commit()
    monkeypatch.setattr(worker_module, "get_settings", lambda: AppSettings(dry_run=True))
    monkeypatch.setattr(worker_module, "session_factory", lambda _url: sessions)
    monkeypatch.setattr(worker_module.signal, "signal", lambda *_a: None)
    assert worker_module.main(["--once"]) == 2
    assert "live SearchTrail installation" in caplog.text


# -- who may open a matter -------------------------------------------------------------------------------
def live_client(sessions, user: UserRow) -> TestClient:
    """Live mode with `user` signed in (WS-C's sign-in, stood in for)."""
    app = create_app(AppSettings(dry_run=False))

    def session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = session
    app.dependency_overrides[current_user] = lambda: user
    return TestClient(app)


def people(sessions) -> tuple[UserRow, UserRow]:
    with sessions() as s:
        dana, _ = repositories.ensure_user(s, **DRY_RUN_USER)
        other, _ = repositories.ensure_user(s, entra_object_id="obj-raj", tenant_id=DRY_RUN_USER["tenant_id"],
                                            email="raj@contoso.com", display_name="Raj Patel")
        s.commit()
        return dana, other


def test_live_matters_without_a_case_are_seen_only_by_their_creator(sessions):
    dana, raj = people(sessions)
    created = live_client(sessions, dana).post("/api/v1/matters", json=FALCON)
    assert created.status_code == 201, created.text
    matter_id = created.json()["id"]

    assert [m["id"] for m in live_client(sessions, dana).get("/api/v1/matters").json()["items"]] == [matter_id]
    assert live_client(sessions, raj).get("/api/v1/matters").json() == {"items": [], "total": 0}
    for request in (lambda c: c.get(f"/api/v1/matters/{matter_id}"),
                    lambda c: c.patch(f"/api/v1/matters/{matter_id}", json={"name": "Taken over"})):
        r = request(live_client(sessions, raj))
        assert r.status_code == 404 and r.json()["code"] == "not_found"  # the same as a matter that doesn't exist
    with sessions() as s:
        assert s.get(MatterRow, matter_id).name == FALCON["name"]


def test_the_access_rule():
    dana, raj = UserRow(id="usr_dana"), UserRow(id="usr_raj")
    no_case = MatterRow(id="mat_1", created_by="usr_dana", purview_case_id=None)
    with_case = MatterRow(id="mat_2", created_by="usr_dana", purview_case_id="case-1")
    assert MatterAccess(raj, dry_run=True).can_open(with_case)  # dry run: one simulated person
    assert MatterAccess(dana, dry_run=False).can_open(no_case)
    assert not MatterAccess(raj, dry_run=False).can_open(no_case)
    # Once there's a case, Purview decides (WS-C asks it); until that's built, nobody gets in.
    assert not MatterAccess(dana, dry_run=False).can_open(with_case)


# -- unexpected errors -------------------------------------------------------------------------------------
def test_an_unexpected_error_still_answers_with_the_error_shape_and_the_security_headers(sessions, monkeypatch):
    from app.api import matters as matters_api

    monkeypatch.setattr(matters_api.repositories, "list_matters", lambda *_a, **_k: 1 / 0)
    r = make_client(sessions, raise_errors=False, dry_run=True).get("/api/v1/matters")
    assert r.status_code == 500 and r.headers["content-type"] == "application/json"
    assert r.json() == {"code": "internal_error", "details": {}, "message": r.json()["message"]}
    assert "It has been logged" in r.json()["message"] and "ZeroDivision" not in r.text
    assert r.headers["x-content-type-options"] == "nosniff" and r.headers["cache-control"] == "no-store"
    assert r.headers["content-security-policy"].startswith("default-src 'none'")


# -- API docs and CORS ---------------------------------------------------------------------------------------
@pytest.mark.parametrize("settings,served", [
    ({"dry_run": True}, True),
    ({"dry_run": False}, False),
    ({"dry_run": False, "api_docs": True}, True),
    ({"dry_run": True, "api_docs": False}, False),
])
def test_the_api_docs_are_on_in_dry_run_and_off_live_unless_asked_for(sessions, settings, served):
    api = make_client(sessions, **settings)
    assert (api.get("/api/docs").status_code == 200) is served
    assert (api.get("/api/openapi.json").status_code == 200) is served


def test_no_other_origin_may_call_the_api_by_default(sessions):
    api = make_client(sessions, dry_run=True)
    preflight = api.options("/api/v1/matters", headers={"Origin": "http://localhost:5173",
                                                        "Access-Control-Request-Method": "POST"})
    assert "access-control-allow-origin" not in preflight.headers
    allowed = make_client(sessions, dry_run=True, cors_origins=["https://review.contoso.com"]).options(
        "/api/v1/matters", headers={"Origin": "https://review.contoso.com", "Access-Control-Request-Method": "POST"})
    assert allowed.headers["access-control-allow-origin"] == "https://review.contoso.com"


# -- the log can't be changed ----------------------------------------------------------------------------------
@pytest.mark.postgres
def test_log_entries_cannot_be_changed_or_deleted_on_postgres(pg_sessions):
    with pg_sessions() as s:
        user, _ = repositories.ensure_user(s, **DRY_RUN_USER)
        matter = repositories.create_matter(s, matter_number="M-1", name="n", type="investigation", description="",
                                            created_by=user.id)
        repositories.append_log(s, matter.id, "matter_created", actor="Dana", actor_email=None, summary="M-1")
        s.commit()
        for statement in ("UPDATE audit_entries SET actor = 'someone else'", "DELETE FROM audit_entries",
                          "TRUNCATE audit_entries"):
            with pytest.raises(DBAPIError, match="append-only"):
                s.execute(text(statement))
            s.rollback()
        assert s.scalar(text("SELECT count(*) FROM audit_entries")) == 1
        repositories.append_log(s, matter.id, "matter_updated", actor="Dana", actor_email=None, summary="still appends")
        s.commit()
        assert s.scalar(text("SELECT count(*) FROM audit_entries")) == 2
