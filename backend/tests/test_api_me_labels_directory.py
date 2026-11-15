"""/me, /labels and /directory/users in dry run, and the conversions behind them."""
from __future__ import annotations

from pathlib import Path

import pytest
import requests
import yaml
from fastapi.testclient import TestClient

from app.db.session import get_session
from app.main import create_app
from app.microsoft.cloud import cloud_for
from app.microsoft.deps import purview_gateway
from app.microsoft.directory import MAX_PEOPLE, directory_users, label_tree
from app.schemas.contract import Cloud, DirectoryUserList, Error, LabelList, Me
from app.settings import AppSettings
from searchtrail.dryrun import SAMPLE_LABELS
from searchtrail.graph import GraphError

CONTRACT = yaml.safe_load((Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml").read_text())


def contract_example(path: str, status: str, name: str) -> dict:
    example = CONTRACT["paths"][path]["get"]["responses"][status]["content"]["application/json"]["examples"][name]
    if "$ref" in example:
        example = CONTRACT["components"]["examples"][example["$ref"].rsplit("/", 1)[-1]]
    return example["value"]


def make_client(sessions, tmp_path, *, dry_run: bool = True, gateway=None) -> TestClient:
    app = create_app(AppSettings(cors_origins=[], dry_run=dry_run, storage_dir=tmp_path / "storage"))

    def session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = session
    if gateway is not None:
        app.dependency_overrides[purview_gateway] = lambda: gateway
    return TestClient(app)


@pytest.fixture
def api(sessions, tmp_path):
    return make_client(sessions, tmp_path)


# -- /me ---------------------------------------------------------------------------------------------
def test_me_is_the_contracts_dry_run_user(api):
    r = api.get("/api/v1/me")
    assert r.status_code == 200, r.text
    assert Me.model_validate(r.json()).dry_run is True
    assert r.json() == contract_example("/me", "200", "dana")  # what the shell was designed with


def test_me_reports_the_cloud_of_the_graph_host(sessions, tmp_path):
    app = create_app(AppSettings(cors_origins=[], dry_run=True, storage_dir=tmp_path,
                                 graph_base="https://graph.microsoft.us/v1.0"))

    def session():
        with sessions() as s:
            yield s

    app.dependency_overrides[get_session] = session
    assert TestClient(app).get("/api/v1/me").json()["cloud"] == "gcc_high"


@pytest.mark.parametrize("base,cloud", [
    ("https://graph.microsoft.com/v1.0", Cloud.COMMERCIAL),
    ("https://graph.microsoft.us/v1.0", Cloud.GCC_HIGH),
    ("https://dod-graph.microsoft.us/beta", Cloud.DOD),
    ("https://GRAPH.microsoft.us", Cloud.GCC_HIGH),
    ("http://localhost:9999/v1.0", Cloud.COMMERCIAL),
])
def test_cloud_for(base, cloud):
    assert cloud_for(base) is cloud


# -- /labels -----------------------------------------------------------------------------------------
def test_labels_are_the_contracts_tree(api):
    r = api.get("/api/v1/labels")
    assert r.status_code == 200, r.text
    LabelList.model_validate(r.json())
    assert r.json() == contract_example("/labels", "200", "contoso")


def test_label_tree_handles_flat_lists_deeper_levels_and_missing_descriptions():
    flat = [  # children point at a parent instead of being nested; ids in any case
        {"id": "AAAAAAAA-0000-4000-8000-000000000001", "displayName": "Confidential", "description": "Top"},
        {"id": "AAAAAAAA-0000-4000-8000-000000000002", "displayName": "Finance",
         "parent": {"id": "aaaaaaaa-0000-4000-8000-000000000001"}},
        {"id": "AAAAAAAA-0000-4000-8000-000000000003", "displayName": "Public", "description": ""},
    ]
    [confidential, public] = label_tree(flat)
    assert (confidential.name, confidential.path, confidential.description) == ("Confidential", "Confidential", "Top")
    assert str(confidential.id) == "aaaaaaaa-0000-4000-8000-000000000001"
    [finance] = confidential.sublabels
    assert (finance.path, finance.description) == ("Confidential/Finance", None)
    assert public.description is None and public.sublabels == []

    nested = [{"id": "11111111-1111-4111-8111-111111111111", "displayName": "A", "sublabels": [
        {"id": "22222222-2222-4222-8222-222222222222", "displayName": "B", "sublabels": [
            {"id": "33333333-3333-4333-8333-333333333333", "displayName": "C"}]}]}]
    assert label_tree(nested)[0].sublabels[0].sublabels[0].path == "A/B/C"
    assert label_tree([]) == []


# -- /directory/users --------------------------------------------------------------------------------
def test_directory_search_is_the_contracts_example(api):
    r = api.get("/api/v1/directory/users", params={"q": "fin"})
    assert r.status_code == 200, r.text
    DirectoryUserList.model_validate(r.json())
    assert r.json() == contract_example("/directory/users", "200", "finance")


def test_directory_search_matches_name_email_and_department_ignoring_case(api):
    def names(q):
        return [u["display_name"] for u in api.get("/api/v1/directory/users", params={"q": q}).json()["items"]]

    assert names("WILBER") == ["Alex Wilber"]
    assert names("ravi.menon@") == ["Ravi Menon"]
    assert names("procurement") == ["Alex Wilber", "Ravi Menon"]
    assert names("zzz") == []
    assert names("  a") == []  # one character once trimmed: nothing, not everyone


def test_directory_search_needs_two_characters(api):
    r = api.get("/api/v1/directory/users", params={"q": "a"})
    assert r.status_code == 400 and Error.model_validate(r.json()).code.value == "validation_failed"
    assert api.get("/api/v1/directory/users").status_code == 400


def test_directory_users_skip_people_without_mail_and_cap_the_list():
    people = [{"id": f"u{i}", "displayName": f"Person {i}", "mail": f"p{i}@contoso.com", "department": None}
              for i in range(MAX_PEOPLE + 10)]
    people.insert(0, {"id": "room", "displayName": "Room 4", "mail": None})
    users = directory_users(people)
    assert len(users) == MAX_PEOPLE and users[0].id == "u0" and users[0].initials == "P0" and users[0].department is None


# -- failures --------------------------------------------------------------------------------------
class Broken:
    def __init__(self, error: Exception):
        self.error = error

    def list_labels(self):
        raise self.error

    def search_users(self, q):
        raise self.error


@pytest.mark.parametrize("error,status,code", [
    (GraphError(429, "GET", "u", ""), 429, "graph_throttled"),
    (GraphError(403, "GET", "u", ""), 403, "purview_permission_missing"),
    (GraphError(401, "GET", "u", ""), 401, "session_expired"),  # the Microsoft token, not a missing role
    (GraphError(503, "GET", "u", ""), 502, "purview_operation_failed"),
    (requests.ConnectionError("down"), 502, "purview_operation_failed"),
])
def test_microsoft_failures_become_contract_errors(sessions, tmp_path, error, status, code):
    api = make_client(sessions, tmp_path, gateway=Broken(error))
    for url, params in (("/api/v1/labels", {}), ("/api/v1/directory/users", {"q": "fin"})):
        r = api.get(url, params=params)
        assert r.status_code == status, r.text
        assert Error.model_validate(r.json()).code.value == code


@pytest.mark.parametrize("url", ["/api/v1/me", "/api/v1/labels", "/api/v1/directory/users?q=fin"])
def test_without_dry_run_there_is_no_way_to_sign_in_yet(sessions, tmp_path, url):
    r = make_client(sessions, tmp_path, dry_run=False).get(url)
    assert r.status_code == 401 and r.json()["code"] == "session_expired"


def test_the_sample_labels_carry_the_contracts_descriptions():
    assert [label.get("description") for label in SAMPLE_LABELS] == [
        "Approved for anyone", "Internal business data", "Includes the Finance and Legal sublabels",
        "Often encrypted; reviewers may not open these"]


# -- the dry-run identity stays in dry run -----------------------------------------------------------------
def test_the_sample_tenant_and_role_are_not_shown_outside_dry_run():
    from app.db.models import UserRow
    from app.microsoft import tenant_and_roles

    user = UserRow(id="usr_x", entra_object_id="o", tenant_id="t-123", email="x@real.example", display_name="Real Person")
    tenant, roles = tenant_and_roles(AppSettings(dry_run=True), user)
    assert (tenant.id, tenant.name, roles) == ("t-123", "Contoso Ltd", ["eDiscovery Manager"])
    with pytest.raises(RuntimeError, match="isn't wired up yet"):  # refuses rather than claim a role for a real person
        tenant_and_roles(AppSettings(dry_run=False), user)
