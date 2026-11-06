"""End-to-end runs against the offline Graph stand-in."""
import json
import shutil
from pathlib import Path

import pytest

from culltool.audit import AuditLog
from culltool.dryrun import DryRunTransport
from culltool.graph import GraphClient
from culltool.labels import LabelIndex
from culltool.matter import MatterError, load_matter
from culltool.workflow import CullWorkflow, ExportBlocked

EXAMPLE = Path(__file__).resolve().parents[1] / "examples" / "matter.json"


@pytest.fixture
def setup(tmp_path):
    transport = DryRunTransport(verbose=False)
    graph = GraphClient("https://graph.microsoft.com/v1.0", transport=transport)
    wf = CullWorkflow(graph, LabelIndex.fetch(graph), tmp_path / "state", "tester@contoso.com",
                      download_token=lambda: "t", log=lambda _msg: None)
    matter_path = tmp_path / "matter.json"
    shutil.copy(EXAMPLE, matter_path)
    return wf, transport, matter_path


def _edit(path: Path, **criteria):
    data = json.loads(path.read_text())
    data["criteria"].update(criteria)
    path.write_text(json.dumps(data))
    return load_matter(path)


def calls(transport, method, suffix):
    return [c for c in transport.calls if c[0] == method and c[1].split("?")[0].endswith(suffix)]


def test_call_sequence_and_preview(setup):
    wf, transport, matter_path = setup
    matter = load_matter(matter_path)
    result = wf.preview(matter)

    sequence = [(m, u.split("/v1.0")[-1]) for m, u, _ in transport.calls]
    posts = [u for m, u in sequence if m == "POST"]
    assert posts[0] == "/security/cases/ediscoveryCases"
    assert posts.count("/security/cases/ediscoveryCases/case-1/custodians") == 2
    assert any(u.endswith("/siteSources") for u in posts)
    assert any(u.endswith("/additionalSources") for u in posts)
    assert posts[-2].endswith("/estimateStatistics") and posts[-1].endswith("/exportReport")

    search_body = calls(transport, "POST", "/searches")[0][2]
    assert search_body["dataSourceScopes"] == "none"
    assert len(search_body["custodianSources@odata.bind"]) == 3  # 2 mailbox/OneDrive sources + 1 site
    assert "NOT InformationProtectionLabelId:11111111-1111-4111-8111-111111111111" in search_body["contentQuery"]

    report_body = calls(transport, "POST", "/exportReport")[0][2]
    assert report_body["exportCriteria"] == "searchHits, partiallyIndexed"

    assert result["report_summary"]["items"] > 0
    assert Path(result["preview_csv"]).is_file()
    entry = AuditLog(wf.matter_dir(matter) / "audit.jsonl").last("preview")
    assert entry["actor"] == "tester@contoso.com" and entry["kql"] == result["kql"]


def test_rerun_reuses_case_and_search_and_patches_query(setup):
    wf, transport, matter_path = setup
    wf.preview(load_matter(matter_path), with_report=False)
    transport.calls.clear()
    wf.preview(_edit(matter_path, keywords=["kickback"]), with_report=False)
    assert not calls(transport, "POST", "/ediscoveryCases")
    assert not calls(transport, "POST", "/searches")
    patch = calls(transport, "PATCH", wf._load_state(load_matter(matter_path))["search"]["id"])
    assert patch and patch[0][2]["contentQuery"].startswith("kickback AND")


def test_new_custodian_creates_a_new_search_version(setup):
    wf, transport, matter_path = setup
    wf.preview(load_matter(matter_path), with_report=False)
    data = json.loads(matter_path.read_text())
    data["custodians"].append({"email": "new.person@contoso.com"})
    matter_path.write_text(json.dumps(data))
    matter = load_matter(matter_path)
    wf.preview(matter, with_report=False)
    state = wf._load_state(matter)
    assert [h["name"] for h in state["search_history"]] == ["M-2026-0142 cull v1", "M-2026-0142 cull v2"]


def test_export_requires_a_matching_preview(setup):
    wf, transport, matter_path = setup
    matter = load_matter(matter_path)
    with pytest.raises(ExportBlocked, match="hasn't been previewed"):
        wf.export(matter, confirm=True)

    wf.preview(matter, with_report=False)
    changed = _edit(matter_path, keywords=["something else"])
    transport.calls.clear()
    with pytest.raises(ExportBlocked, match="hasn't been previewed"):
        wf.export(changed, confirm=True)
    assert all(method == "GET" for method, _, _ in transport.calls)  # a blocked export changes nothing

    data = json.loads(matter_path.read_text())
    data["custodians"].append({"email": "late.addition@contoso.com"})
    matter_path.write_text(json.dumps(data))
    with pytest.raises(ExportBlocked, match="hasn't been previewed"):
        wf.export(load_matter(matter_path), confirm=True)  # new custodian since the preview
    assert all(method == "GET" for method, _, _ in transport.calls)
    changed = load_matter(matter_path)

    wf.preview(changed, with_report=False)
    unconfirmed = wf.export(changed)
    assert unconfirmed["confirmed"] is False and not calls(transport, "POST", "/exportResult")

    done = wf.export(changed, confirm=True, wait=True)
    assert done["confirmed"] and done["status"] == "succeeded"
    body = calls(transport, "POST", "/exportResult")[0][2]
    assert body["exportFormat"] == "pst" and body["exportLocation"] == "responsiveLocations"
    actions = [e["action"] for e in AuditLog(wf.matter_dir(changed) / "audit.jsonl").entries()]
    assert actions[-2:] == ["export_started", "export_finished"]


def test_export_blocks_when_counts_drift(setup):
    wf, transport, matter_path = setup
    matter = load_matter(matter_path)
    wf.preview(matter, with_report=False)
    transport.count_offset = 17  # new mail arrived since the preview
    with pytest.raises(ExportBlocked, match="Counts changed"):
        wf.export(matter, confirm=True)
    result = wf.export(matter, confirm=True, accept_changes=True)
    assert result["confirmed"]
    entry = AuditLog(wf.matter_dir(matter) / "audit.jsonl").last("export_started")
    assert entry["changes_accepted"]["indexedItemCount"]["now"] - entry["changes_accepted"]["indexedItemCount"]["preview"] == 17


def test_term_report(setup):
    wf, transport, matter_path = setup
    rows = wf.term_report(load_matter(matter_path))
    assert [r["term"] for r in rows] == ["project falcon", "invoic*", "kickback", "side letter", "(all terms combined)"]
    assert len(calls(transport, "POST", "/estimateStatistics")) == 5
    assert rows[-1]["items"] >= max(r["items"] for r in rows[:-1])  # OR of terms never finds fewer


def test_cli_dry_run_across_separate_commands(tmp_path, monkeypatch, capsys):
    """Each CLI command is a new process; the simulated tenant must persist like a real one."""
    from culltool.cli import main

    monkeypatch.setenv("CULLTOOL_STATE_DIR", str(tmp_path / "state"))
    monkeypatch.chdir(tmp_path)
    assert main(["--dry-run", "--quiet", "preview", str(EXAMPLE)]) == 0
    assert main(["--dry-run", "--quiet", "export", str(EXAMPLE), "--confirm", "--wait"]) == 0
    out = capsys.readouterr().out
    assert "Export started" in out and "Finished with status: succeeded" in out
    assert main(["--dry-run", "verify-log", str(EXAMPLE)]) == 0
    assert "chain intact" in capsys.readouterr().out


def test_matter_file_typos_are_rejected(tmp_path):
    bad = json.loads(EXAMPLE.read_text())
    bad["custodain"] = []
    path = tmp_path / "bad.json"
    path.write_text(json.dumps(bad))
    with pytest.raises(MatterError, match="custodain"):
        load_matter(path)
