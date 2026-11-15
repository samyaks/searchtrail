"""The backend against contracts/openapi.yaml.

1. Every route the app serves is in the contract, with the same method and operationId, and
   uses the contract's (generated) model for its success response.
2. Every JSON example in the contract validates against the generated Pydantic models, so the
   models, the examples (which feed the frontend mocks) and the schemas agree.
3. The KQL example is what query.py really produces.
Generated code being up to date is checked separately in CI (scripts/codegen.sh, then git diff).
"""
from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from app.main import create_app
from app.schemas import contract
from app.settings import AppSettings

CONTRACT = yaml.safe_load((Path(__file__).resolve().parents[2] / "contracts" / "openapi.yaml").read_text())
PREFIX = "/api/v1"


def _resolve(node: dict) -> dict:
    while "$ref" in node:
        parts = node["$ref"].removeprefix("#/").split("/")
        node = CONTRACT
        for part in parts:
            node = node[part]
    return node


def _json_examples():
    for item in CONTRACT["paths"].values():
        for method, op in item.items():
            if method == "parameters":
                continue
            bodies = [("request", op.get("requestBody", {}))] + [(f"{s}", r) for s, r in op.get("responses", {}).items()]
            for where, body in bodies:
                media = _resolve(body).get("content", {}).get("application/json")
                if not media or "$ref" not in media.get("schema", {}):
                    continue
                schema = media["schema"]["$ref"].rsplit("/", 1)[-1]
                for name, example in (media.get("examples") or {}).items():
                    yield pytest.param(schema, _resolve(example)["value"], id=f"{op['operationId']}-{where}-{name}")


def test_every_route_is_in_the_contract():
    app = create_app(AppSettings(cors_origins=[]))
    served = app.openapi()["paths"]
    assert served, "the app serves no routes"
    for path, item in served.items():
        assert path.startswith(PREFIX), path
        spec_path = CONTRACT["paths"].get(path.removeprefix(PREFIX))
        assert spec_path is not None, f"{path} is not in contracts/openapi.yaml"
        for method, op in item.items():
            spec_op = spec_path.get(method)
            assert spec_op is not None, f"{method.upper()} {path} is not in the contract"
            assert op.get("operationId") == spec_op["operationId"], f"{method.upper()} {path}: operationId"
            for status, resp in op.get("responses", {}).items():
                if status == "422":  # FastAPI's default validation response; ours returns 400 (see errors.py)
                    continue
                assert status in spec_op["responses"], f"{method.upper()} {path} returns {status}, not in the contract"
                served_ref = resp.get("content", {}).get("application/json", {}).get("schema", {}).get("$ref")
                spec_media = _resolve(spec_op["responses"][status]).get("content", {}).get("application/json", {})
                spec_ref = spec_media.get("schema", {}).get("$ref")
                if served_ref and spec_ref:
                    assert served_ref.rsplit("/", 1)[-1] == spec_ref.rsplit("/", 1)[-1], f"{method.upper()} {path} {status}"


@pytest.mark.parametrize("schema,value", list(_json_examples()))
def test_contract_examples_match_the_generated_models(schema, value):
    getattr(contract, schema).model_validate(value)


def _key_paths(value, prefix: str = "") -> set[str]:
    paths: set[str] = set()
    if isinstance(value, dict):
        for key, item in value.items():
            path = f"{prefix}.{key}" if prefix else str(key)
            paths |= {path} | _key_paths(item, path)
    elif isinstance(value, list):
        for index, item in enumerate(value):
            paths |= _key_paths(item, f"{prefix}[{index}]")
    return paths


@pytest.mark.parametrize("schema,value", list(_json_examples()))
def test_contract_examples_have_no_keys_the_models_do_not_know(schema, value):
    """The generated models ignore unknown keys, so a typo in an example would pass the test above and
    then reach the frontend mocks. The classic case is an unquoted `summary: ... 1,148 items` inside a
    flow mapping: YAML splits it at the comma into a short summary and a stray key."""
    model = getattr(contract, schema).model_validate(value)
    known = json.loads(model.model_dump_json(exclude_unset=True, by_alias=True))
    stray = sorted(_key_paths(value) - _key_paths(known))
    assert not stray, f"keys in the example that {schema} does not define: {stray[:5]}"


def test_kql_example_is_real_query_builder_output():
    from searchtrail.dryrun import SAMPLE_LABELS
    from searchtrail.labels import LabelIndex
    from searchtrail.query import CullCriteria, build_kql, describe

    examples = CONTRACT["components"]["examples"]
    criteria = CullCriteria.from_dict(examples["CriteriaRequestFalcon"]["value"]["criteria"])
    preview = examples["KqlPreviewFalcon"]["value"]
    assert preview["kql"] == build_kql(criteria)
    assert preview["length"] == len(preview["kql"])
    assert preview["methodology"] == describe(criteria, LabelIndex.from_graph_items(SAMPLE_LABELS).name_for).splitlines()


def test_error_codes_cover_the_plan():
    required = {"criteria_invalid", "export_not_previewed", "export_counts_changed", "confirmation_mismatch",
                "purview_permission_missing", "license_missing", "graph_throttled", "purview_operation_failed",
                "session_expired"}
    assert required <= {c.value for c in contract.ErrorCode}


def test_every_kind_of_job_has_a_finished_example_with_the_right_result():
    """Mocks (and the frontend's job screens) run a job to its end; they need a result for each kind."""
    op = CONTRACT["paths"]["/jobs/{jobId}"]["get"]
    examples = _resolve(op["responses"]["200"])["content"]["application/json"]["examples"]
    finished = {}
    for name, example in examples.items():
        job = contract.Job.model_validate(_resolve(example)["value"])
        if job.status.value == "succeeded":
            finished[job.kind.value] = (name, job)
    assert set(finished) == {kind.value for kind in contract.JobKind}, sorted(finished)

    results = {kind: job.result for kind, (_name, job) in finished.items()}
    assert isinstance(results["estimate"], contract.EstimateResult)
    assert isinstance(results["preview"], contract.Preview)
    assert isinstance(results["term_report"], contract.TermReport)
    for kind in ("export", "download", "review_set"):
        assert isinstance(results[kind], contract.Export), kind
    assert results["export"].status.value == "ready"
    assert results["download"].download.status.value == "done" and results["download"].download.stored_path
    assert results["review_set"].review_set.status.value == "done" and results["review_set"].review_set.name
    for _name, job in finished.values():  # each is the job its 202 example started, a little later
        assert job.progress == 1 and job.error is None and job.updated_at > job.created_at
