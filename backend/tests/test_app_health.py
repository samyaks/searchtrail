from fastapi.testclient import TestClient

from app.db.session import get_session
from app.main import create_app
from app.schemas.contract import Health
from app.settings import AppSettings


def client(sessions=None, broken=False, **settings):
    app = create_app(AppSettings(cors_origins=[], **settings))

    def session():
        if broken:
            raise_on_use = sessions()
            raise_on_use.execute = lambda *_a, **_k: (_ for _ in ()).throw(RuntimeError("db down"))
            yield raise_on_use
        else:
            with sessions() as s:
                yield s

    app.dependency_overrides[get_session] = session
    return TestClient(app)


def test_health_ok(sessions):
    r = client(sessions, dry_run=True).get("/api/v1/health")
    assert r.status_code == 200
    body = Health.model_validate(r.json())
    assert body.status == "ok" and body.database == "ok" and body.dry_run is True
    assert r.headers["x-content-type-options"] == "nosniff"


def test_health_degraded_when_database_is_down(sessions):
    r = client(sessions, broken=True).get("/api/v1/health")
    assert r.status_code == 503
    assert Health.model_validate(r.json()).database == "unreachable"


def test_unknown_route_uses_the_error_shape(sessions):
    r = client(sessions).get("/api/v1/nope")
    assert r.status_code == 404
    assert r.json() == {"code": "not_found", "message": "Not Found", "details": {}}


def test_security_headers_except_csp_on_the_api_docs(sessions):
    c = client(sessions)
    assert c.get("/api/v1/health").headers["content-security-policy"].startswith("default-src 'none'")
    docs = c.get("/api/docs")
    assert docs.status_code == 200
    assert "content-security-policy" not in docs.headers
    assert docs.headers["x-content-type-options"] == "nosniff"
