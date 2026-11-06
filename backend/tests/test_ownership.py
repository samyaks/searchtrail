"""scripts/check_ownership.py: path ownership, CODEOWNERS and the PR check."""
import importlib.util
import sys
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[2]
_spec = importlib.util.spec_from_file_location("check_ownership", ROOT / "scripts" / "check_ownership.py")
own = importlib.util.module_from_spec(_spec)
sys.modules["check_ownership"] = own  # dataclasses look their module up while the class is built
_spec.loader.exec_module(own)
AREAS = own.load()


@pytest.mark.parametrize("path,key", [
    ("contracts/openapi.yaml", "contract"),
    ("backend/searchtrail/gateway.py", "contract"),
    ("backend/searchtrail/gateway_graph.py", "C"),
    ("backend/searchtrail/workflow.py", "B2"),
    ("backend/searchtrail/query.py", "shared"),
    ("backend/app/schemas/contract.py", "generated"),
    ("backend/app/schemas/helpers.py", "B1"),
    ("frontend/src/screens/log/LogScreen.tsx", "F"),
    ("frontend/tests/e2e/flow.spec.ts", "G"),
    ("frontend/package.json", "D"),
])
def test_most_specific_owner_wins(path, key):
    assert own.owner_of(path, AREAS).key == key


def test_codeowners_is_up_to_date():
    assert (ROOT / ".github" / "CODEOWNERS").read_text() == own.render_codeowners(AREAS)


def test_contract_changes_need_a_contract_pr():
    errors, _, _ = own.check_pr(["contracts/openapi.yaml", "backend/app/api/matters.py"], "[B1] Matters", AREAS)
    assert errors and "[contract]" in errors[0]
    errors, warnings, _ = own.check_pr(["contracts/openapi.yaml", "backend/app/schemas/contract.py"],
                                       "[contract] Add archive", AREAS)
    assert not errors and not warnings


def test_crossing_workstreams_warns():
    errors, warnings, summary = own.check_pr(
        ["frontend/src/screens/scope/ScopeScreen.tsx", "frontend/src/components/Button.tsx"], "[E] Scope", AREAS)
    assert not errors and any("WS-D" in w for w in warnings)
    assert "WS-E" in summary and "WS-D" in summary


def test_missing_title_prefix_and_hand_edited_generated_files_warn():
    _, warnings, _ = own.check_pr(["frontend/src/api/schema.d.ts"], "fix types", AREAS)
    assert len(warnings) == 2
