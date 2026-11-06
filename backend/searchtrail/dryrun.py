"""An offline stand-in for Microsoft Graph.

Lets you run the whole flow, and the tests, with no tenant: every call is printed, and
plausible responses come back. Counts are derived from the query text, so changing the query
changes the numbers, which is enough to exercise the preview, term report and export checks.
"""
from __future__ import annotations

import csv
import hashlib
import io
import json
import random
import re
import zipfile
from pathlib import Path
from typing import Any

from requests.structures import CaseInsensitiveDict

from .graph import Log, Response

SAMPLE_LABELS = [
    {"id": "11111111-1111-4111-8111-111111111111", "displayName": "Public"},
    {"id": "22222222-2222-4222-8222-222222222222", "displayName": "General"},
    {"id": "33333333-3333-4333-8333-333333333333", "displayName": "Confidential", "sublabels": [
        {"id": "44444444-4444-4444-8444-444444444444", "displayName": "Finance"},
        {"id": "55555555-5555-4555-8555-555555555555", "displayName": "Legal"},
    ]},
    {"id": "66666666-6666-4666-8666-666666666666", "displayName": "Highly Confidential"},
]
APPLIED_LABEL_IDS = [  # parent labels with sublabels can't be applied to files, so they never appear
    "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222",
    "44444444-4444-4444-8444-444444444444", "55555555-5555-4555-8555-555555555555",
    "66666666-6666-4666-8666-666666666666", "",
]
_ACTION_RE = re.compile(r"/searches/([^/?]+)/(estimateStatistics|exportReport|exportResult)$")
# Actions with no counts or files: holds and adding a search to a review set.
_PLAIN_ACTION_RE = re.compile(r"/(custodians/[^/?]+/(?:applyHold|removeHold)|reviewSets/[^/?]+/addToReviewSet)$")
# People in the simulated directory (the sample data on the Define screen).
SAMPLE_DIRECTORY = [
    {"id": "3c1a7f5e-0000-4000-8000-0000000000a1", "displayName": "Alex Wilber", "mail": "alex.wilber@contoso.com",
     "department": "Procurement"},
    {"id": "3c1a7f5e-0000-4000-8000-0000000000b2", "displayName": "Megan Bowen", "mail": "megan.bowen@contoso.com",
     "department": "Finance"},
    {"id": "3c1a7f5e-0000-4000-8000-0000000000c3", "displayName": "Hannah Ortega", "mail": "hannah.ortega@contoso.com",
     "department": "Finance"},
    {"id": "3c1a7f5e-0000-4000-8000-0000000000d4", "displayName": "Ravi Menon", "mail": "ravi.menon@contoso.com",
     "department": "Procurement"},
    {"id": "3c1a7f5e-0000-4000-8000-0000000000e5", "displayName": "Tomas Becker", "mail": "tomas.becker@contoso.com",
     "department": "Sales"},
    {"id": "3c1a7f5e-0000-4000-8000-0000000000f6", "displayName": "Grace Okafor", "mail": "grace.okafor@contoso.com",
     "department": "Legal"},
]


def _h(text: str) -> int:
    return int(hashlib.sha256(text.encode("utf-8")).hexdigest(), 16)


def _split_first_clause(kql: str) -> tuple[str, str]:
    if kql.startswith("("):
        depth = 0
        for i, ch in enumerate(kql):
            depth += ch == "("
            depth -= ch == ")"
            if depth == 0:
                return kql[1:i], kql[i + 1:]
    head, _, rest = kql.partition(" AND ")
    return head, rest


def fake_count(kql: str) -> int:
    """Plausible counts: OR-ing more terms finds more, never fewer, than any single term."""
    if not kql:
        return 0
    first, rest = _split_first_clause(kql)
    weights = [300 + _h(t.strip()) % 1500 for t in first.split(" OR ")]
    combined = max(max(weights), int(sum(weights) * 0.75))
    return max(1, int(combined * (0.15 + (_h(rest) % 25) / 100)))


class DryRunTransport:
    def __init__(self, log: Log = print, verbose: bool = True, state_file: Path | None = None):
        self.log = log
        self.verbose = verbose
        self.calls: list[tuple[str, str, Any]] = []
        self.count_offset = 0  # tests bump this to simulate data changing between preview and export
        self._ops: dict[str, dict] = {}
        self._downloads: dict[str, dict] = {}
        self._review_sets: dict[str, dict] = {}
        # Remembered between CLI runs (when state_file is set), like a real tenant would.
        self.state_file = Path(state_file) if state_file else None
        saved = json.loads(self.state_file.read_text()) if self.state_file and self.state_file.exists() else {}
        self._next_id: int = saved.get("next_id", 1)
        self._queries: dict[str, str] = saved.get("queries", {})
        self._emails: list[str] = saved.get("emails", [])

    def _save(self) -> None:
        if self.state_file:
            self.state_file.parent.mkdir(parents=True, exist_ok=True)
            self.state_file.write_text(json.dumps(
                {"next_id": self._next_id, "queries": self._queries, "emails": self._emails}, indent=2))

    def _new_id(self, prefix: str) -> str:
        self._next_id += 1
        self._save()
        return f"{prefix}-{self._next_id - 1}"

    def handle(self, method: str, url: str, body: dict | None) -> Response:
        self.calls.append((method, url, body))
        path = re.sub(r"^https://graph\.microsoft\.com/v1\.0", "", url).split("?", 1)[0]
        if self.verbose:
            self.log(f"  [dry-run] {method:5} {path}")
            if body:
                self.log("                " + json.dumps(body)[:400])

        def ok(data: dict | None = None, status: int = 200, headers: dict | None = None) -> Response:
            return Response(status, data or {}, CaseInsensitiveDict(headers or {}))

        if method == "GET" and path.endswith("/sensitivityLabels"):
            return ok({"value": SAMPLE_LABELS})
        if method == "GET" and path == "/users":
            return ok({"value": SAMPLE_DIRECTORY})
        if method == "GET" and path.endswith("/reviewSets"):
            return ok({"value": list(self._review_sets.values())})
        if method == "POST" and path.endswith("/reviewSets"):
            rs = {"id": self._new_id("reviewset"), "displayName": body["displayName"]}
            self._review_sets[rs["id"]] = rs
            return ok(rs, 201)
        if method == "POST" and (m := _PLAIN_ACTION_RE.search(path)):
            op_id = self._new_id("op")
            self._ops[op_id] = {"action": m.group(1).rsplit("/", 1)[-1], "search": "", "body": body}
            case_url = re.match(r"(.*/ediscoveryCases/[^/]+)", url.split("?", 1)[0]).group(1)
            location = f"{case_url}/operations/{op_id}"
            return ok(status=202, headers={"Location": location})
        if method == "GET" and re.search(r"/(ediscoveryCases|custodians|userSources)$", path):
            return ok({"value": []})
        if method == "GET" and re.search(r"/ediscoveryCases/[^/]+$", path):
            return ok({"id": path.rsplit("/", 1)[-1]})
        if method == "GET" and "/operations/" in path:
            return ok(self._operation(path.rsplit("/", 1)[-1]))
        if method == "POST" and path.endswith("/ediscoveryCases"):
            return ok({"id": self._new_id("case"), "displayName": body["displayName"]}, 201)
        if method == "POST" and path.endswith("/custodians"):
            self._emails.append(body["email"])
            self._save()
            return ok({"id": self._new_id("custodian"), "email": body["email"]}, 201)
        if method == "POST" and path.endswith("/userSources"):
            return ok({"id": self._new_id("usersource"), "email": body["email"]}, 201)
        if method == "POST" and path.endswith(("/siteSources", "/additionalSources")):
            return ok({"id": self._new_id("sitesource")}, 201)
        if method == "POST" and path.endswith("/searches"):
            sid = self._new_id("search")
            self._queries[sid] = body.get("contentQuery", "")
            self._save()
            return ok({"id": sid, "displayName": body["displayName"]}, 201)
        if method == "PATCH" and "/searches/" in path:
            self._queries[path.rsplit("/", 1)[-1]] = body.get("contentQuery", "")
            self._save()
            return ok(status=204)
        if method == "POST" and (m := _ACTION_RE.search(path)):
            op_id = self._new_id("op")
            self._ops[op_id] = {"action": m.group(2), "search": m.group(1), "body": body}
            location = url.split("/searches/", 1)[0] + f"/operations/{op_id}"
            return ok(status=202, headers={"Location": location})
        return ok()

    def _operation(self, op_id: str) -> dict:
        op = self._ops.get(op_id, {"action": "estimateStatistics", "search": ""})
        count = fake_count(self._queries.get(op["search"], "")) + self.count_offset
        result: dict[str, Any] = {"id": op_id, "status": "succeeded", "percentProgress": 100}
        if op["action"] in ("applyHold", "removeHold", "addToReviewSet"):
            return result
        if op["action"] == "estimateStatistics":
            result.update(indexedItemCount=count, indexedItemsSize=count * 48_213,
                          unindexedItemCount=count // 25, unindexedItemsSize=(count // 25) * 911_000,
                          mailboxCount=max(1, len(self._emails)), siteCount=max(1, len(self._emails)) + 1)
        else:
            kind = "report" if op["action"] == "exportReport" else "export"
            url = f"dry://{op_id}/{kind}.zip"
            rows = count + (count // 25 if "partiallyIndexed" in (op.get("body") or {}).get("exportCriteria", "") else 0)
            self._downloads[url] = {"kind": kind, "rows": rows, "kql": self._queries.get(op["search"], "")}
            result["exportFileMetadata"] = [{"fileName": f"{kind}-{op_id}.zip", "downloadUrl": url, "size": 0}]
        return result

    def download(self, url: str, dest: Path) -> Path:
        info = self._downloads.get(url, {"kind": "report", "rows": 50, "kql": ""})
        if self.verbose:
            self.log(f"  [dry-run] DOWNLOAD {url} -> {dest}")
        if info["kind"] == "report":
            write_sample_report(dest, rows=info["rows"], emails=self._emails or ["custodian@contoso.com"], kql=info["kql"])
        else:
            dest.write_bytes(b"(dry-run export package placeholder)")
        return dest


def _sample_filters(kql: str) -> tuple[list[str], str, str]:
    """Pull the label and date filters out of a query, so synthetic rows look consistent with it."""
    excluded = set(re.findall(r"NOT InformationProtectionLabelId:([0-9a-f-]{36})", kql))
    included = set(re.findall(r"(?<!NOT )InformationProtectionLabelId:([0-9a-f-]{36})", kql))
    labels = [g for g in APPLIED_LABEL_IDS if g not in excluded and (not included or g in included)] or [""]
    start = (re.findall(r">=(\d{4}-\d{2}-\d{2})", kql) or ["2024-01-01"])[0]
    end = (re.findall(r"<=(\d{4}-\d{2}-\d{2})", kql) or ["2025-12-31"])[0]
    return labels, start, end


def write_sample_report(dest: Path, rows: int, emails: list[str], kql: str = "", seed: int = 7) -> Path:
    """A synthetic item report. Real Purview column names may differ; see report.COLUMN_CANDIDATES."""
    from datetime import date, timedelta

    labels, start, end = _sample_filters(kql)
    first, span = date.fromisoformat(start), (date.fromisoformat(end) - date.fromisoformat(start)).days
    rng = random.Random(seed + rows)
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["Item Identity", "Location", "Item class", "Subject/Title", "Sender/Author",
                     "Date", "Size", "Sensitivity label", "IsEncrypted"])
    kinds = [("IPM.Note", "RE: Falcon supplier payment {n}"), ("IPM.SkypeTeams.Message", "Chat: Falcon follow-up {n}"),
             ("Document", "Falcon side letter v{n}.docx")]
    for n in range(1, rows + 1):
        item_class, subject = rng.choice(kinds)
        label = rng.choice(labels)
        writer.writerow([
            f"dry-item-{n:05d}", rng.choice(emails), item_class, subject.format(n=n), rng.choice(emails),
            f"{first + timedelta(days=rng.randint(0, max(span, 0)))}T10:00:00Z",
            rng.randint(2_000, 95_000), label,
            "true" if label.startswith("66666666") and rng.random() < 0.5 else "false",
        ])
    dest.parent.mkdir(parents=True, exist_ok=True)
    with zipfile.ZipFile(dest, "w") as zf:
        zf.writestr("Items_0_2026-11-05.csv", buf.getvalue())
        zf.writestr("Summary_2026-11-05.csv", f"Name,Value\nItems,{rows}\n")
    return dest
