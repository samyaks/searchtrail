import json
import zipfile

import pytest

from culltool.audit import AuditLog
from culltool.dryrun import SAMPLE_LABELS, write_sample_report
from culltool.labels import LabelError, LabelIndex
from culltool.report import load_report, map_columns, summarize, write_preview_csv

FINANCE = "44444444-4444-4444-8444-444444444444"
LEGAL = "55555555-5555-4555-8555-555555555555"
CONFIDENTIAL = "33333333-3333-4333-8333-333333333333"


@pytest.fixture
def labels():
    return LabelIndex.from_graph_items(SAMPLE_LABELS)


def test_label_paths_and_lookup(labels):
    assert labels.name_for(FINANCE) == "Confidential/Finance"
    assert labels.resolve("confidential/legal") == [LEGAL]
    assert labels.resolve("Highly Confidential") == ["66666666-6666-4666-8666-666666666666"]
    assert labels.display(FINANCE.upper()) == "Confidential/Finance"
    assert labels.display("Some Name") == "Some Name"


def test_parent_label_expands_to_sublabels(labels):
    # Files carry the sublabel ID, so filtering on the parent alone would miss them.
    assert labels.resolve("Confidential") == [CONFIDENTIAL, FINANCE, LEGAL]


def test_flat_label_list_with_parent_links():
    flat = [{"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "name": "Secret"},
            {"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "name": "HR",
             "parent": {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"}}]
    index = LabelIndex.from_graph_items(flat)
    assert index.name_for("bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb") == "Secret/HR"


def test_unknown_and_ambiguous_labels():
    index = LabelIndex.from_graph_items([
        {"id": "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", "displayName": "A", "sublabels": [
            {"id": "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", "displayName": "Legal"}]},
        {"id": "cccccccc-cccc-4ccc-8ccc-cccccccccccc", "displayName": "B", "sublabels": [
            {"id": "dddddddd-dddd-4ddd-8ddd-dddddddddddd", "displayName": "Legal"}]},
    ])
    with pytest.raises(LabelError, match="ambiguous"):
        index.resolve("Legal")
    assert index.resolve("B/Legal") == ["dddddddd-dddd-4ddd-8ddd-dddddddddddd"]
    with pytest.raises(LabelError, match="No sensitivity label"):
        index.resolve("Nope")


def test_column_mapping_tolerates_header_variants():
    cmap, unmapped = map_columns(["﻿Item Identity", "Location ", "SENSITIVITY LABEL ID", "Is Encrypted", "Odd"])
    assert cmap["item_id"] == "﻿Item Identity"
    assert cmap["location"] == "Location "
    assert cmap["label"] == "SENSITIVITY LABEL ID"
    assert cmap["encrypted"] == "Is Encrypted"
    assert unmapped == ["Odd"]


def test_report_from_nested_zip_and_summary(tmp_path, labels):
    inner = write_sample_report(tmp_path / "inner.zip", rows=40, emails=["a@contoso.com", "b@contoso.com"])
    outer = tmp_path / "outer.zip"
    with zipfile.ZipFile(outer, "w") as zf:
        zf.write(inner, "Reports/inner.zip")
    report = load_report([outer])
    assert len(report.rows) == 40  # the summary CSV is ignored because item CSVs exist
    summary = summarize(report, labels)
    assert summary["items"] == 40
    assert sum(count for _, count in summary["by_label"]) == 40
    assert all("Unknown label" not in name for name, _ in summary["by_label"])
    assert {name for name, _ in summary["by_location"]} <= {"a@contoso.com", "b@contoso.com"}
    preview = write_preview_csv(report, labels, tmp_path / "preview.csv")
    lines = preview.read_text(encoding="utf-8").splitlines()
    assert lines[0].startswith("item_id,location,item_type,subject") and len(lines) == 41


def test_audit_chain_detects_tampering(tmp_path):
    log = AuditLog(tmp_path / "audit.jsonl")
    log.append(action="preview", kql="a", counts={"indexedItemCount": 1})
    log.append(action="export_started", kql="a")
    assert log.verify() == (True, "2 entries verified, chain intact")
    assert log.last("preview")["seq"] == 1

    lines = log.path.read_text(encoding="utf-8").splitlines()
    first = json.loads(lines[0])
    first["counts"]["indexedItemCount"] = 999
    log.path.write_text("\n".join([json.dumps(first)] + lines[1:]) + "\n", encoding="utf-8")
    ok, message = log.verify()
    assert not ok and "Entry 1" in message

    log.path.write_text(lines[1] + "\n", encoding="utf-8")  # first entry deleted
    ok, message = log.verify()
    assert not ok and "chain broken" in message
