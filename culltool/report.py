"""Read Purview's export report (item.csv) and summarize it for the preview.

Column names in Purview reports have changed over time, so columns are matched by a list of
likely names. The first real run prints the column map: check it, and extend
COLUMN_CANDIDATES if a field shows up as unmapped.
"""
from __future__ import annotations

import csv
import io
import re
import zipfile
from collections import Counter
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

from .labels import LabelIndex

COLUMN_CANDIDATES: dict[str, list[str]] = {
    "item_id": ["item identity", "item id", "immutable id", "document id", "itemid", "id"],
    "location": ["location", "location name", "source", "custodian"],
    "item_type": ["item class", "type", "kind", "item type", "file type"],
    "subject": ["subject/title", "subject", "title", "file name", "name"],
    "author": ["sender/author", "sender", "author", "from", "created by"],
    "date": ["date", "sent", "received", "last modified", "date modified", "modified date"],
    "size": ["size", "size (bytes)"],
    "label": ["sensitivity label", "sensitivitylabel", "sensitivity label id", "information protection label id"],
    "encrypted": ["isencrypted", "is encrypted", "encrypted"],
}
PREVIEW_COLUMNS = ["item_id", "location", "item_type", "subject", "author", "date", "size", "sensitivity_label", "encrypted"]
_LABEL_SPLIT = re.compile(r"[;,|]")
_ISO_MONTH = re.compile(r"^(\d{4})-(\d{2})")
_US_DATE = re.compile(r"^(\d{1,2})/(\d{1,2})/(\d{4})")


@dataclass
class Report:
    rows: list[dict[str, str]]
    column_map: dict[str, str]  # our field name -> CSV header
    unmapped: list[str]
    files: list[str] = field(default_factory=list)

    def value(self, row: dict, name: str) -> str:
        header = self.column_map.get(name)
        return (row.get(header) or "").strip() if header else ""


def _norm(header: str) -> str:
    return " ".join(header.replace("﻿", "").strip().lower().split())


def map_columns(headers: list[str]) -> tuple[dict[str, str], list[str]]:
    normed = {_norm(h): h for h in headers}
    cmap: dict[str, str] = {}
    for name, candidates in COLUMN_CANDIDATES.items():
        for candidate in candidates:
            if candidate in normed and normed[candidate] not in cmap.values():
                cmap[name] = normed[candidate]
                break
    for name, needle in (("label", "sensitivity"), ("encrypted", "encrypt")):
        if name not in cmap:
            hit = next((h for n, h in normed.items() if needle in n and h not in cmap.values()), None)
            if hit:
                cmap[name] = hit
    used = set(cmap.values())
    return cmap, [h for h in headers if h not in used]


def _collect(paths: Iterable[str | Path]) -> list[tuple[str, bytes]]:
    """All CSVs in the given files, folders and zips (including zips inside zips)."""
    found: list[tuple[str, bytes]] = []

    def add_zip(zf: zipfile.ZipFile, prefix: str) -> None:
        for info in zf.infolist():
            lower = info.filename.lower()
            if lower.endswith(".csv"):
                found.append((f"{prefix}/{info.filename}", zf.read(info)))
            elif lower.endswith(".zip"):
                with zipfile.ZipFile(io.BytesIO(zf.read(info))) as inner:
                    add_zip(inner, f"{prefix}/{info.filename}")

    for p in map(Path, paths):
        if p.is_dir():
            found.extend(_collect(sorted(x for x in p.rglob("*") if x.is_file())))
        elif p.suffix.lower() == ".zip":
            with zipfile.ZipFile(p) as zf:
                add_zip(zf, p.name)
        elif p.suffix.lower() == ".csv":
            found.append((p.name, p.read_bytes()))
    return found


def load_report(paths: Iterable[str | Path]) -> Report:
    # Note: reads each CSV into memory. Fine for previews; stream it for very large reports.
    blobs = _collect(paths)
    item_blobs = [b for b in blobs if "item" in b[0].rsplit("/", 1)[-1].lower()] or blobs
    rows: list[dict[str, str]] = []
    headers: list[str] = []
    for _name, data in item_blobs:
        reader = csv.DictReader(io.StringIO(data.decode("utf-8-sig", errors="replace")))
        for h in reader.fieldnames or []:
            if h not in headers:
                headers.append(h)
        rows.extend(reader)
    cmap, unmapped = map_columns(headers)
    return Report(rows, cmap, unmapped, [name for name, _ in item_blobs])


def item_labels(report: Report, row: dict) -> list[str]:
    raw = report.value(row, "label")
    return [part.strip() for part in _LABEL_SPLIT.split(raw) if part.strip()] if raw else []


def _month(value: str) -> str | None:
    if m := _ISO_MONTH.match(value):
        return f"{m.group(1)}-{m.group(2)}"
    if m := _US_DATE.match(value):  # assumes M/D/YYYY, as US-locale Purview reports use
        return f"{m.group(3)}-{int(m.group(1)):02d}"
    return None


def _is_true(value: str) -> bool:
    return value.strip().lower() in ("true", "yes", "1")


def summarize(report: Report, labels: LabelIndex, top: int = 15) -> dict:
    by_location, by_type, by_label, by_month = Counter(), Counter(), Counter(), Counter()
    encrypted = total_size = 0
    for row in report.rows:
        by_location[report.value(row, "location") or "(unknown)"] += 1
        by_type[report.value(row, "item_type") or "(unknown)"] += 1
        found = item_labels(report, row)
        for value in found or ["(no label)"]:
            by_label[labels.display(value) if found else value] += 1
        if _is_true(report.value(row, "encrypted")):
            encrypted += 1
        try:
            total_size += int(float(report.value(row, "size") or 0))
        except ValueError:
            pass
        month = _month(report.value(row, "date"))
        if month:
            by_month[month] += 1
    return {
        "items": len(report.rows),
        "total_size_bytes": total_size,
        "encrypted_items": encrypted,
        "by_location": by_location.most_common(top),
        "by_type": by_type.most_common(top),
        "by_label": by_label.most_common(top),
        "by_month": sorted(by_month.items()),
    }


def write_preview_csv(report: Report, labels: LabelIndex, dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    with open(dest, "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=PREVIEW_COLUMNS)
        writer.writeheader()
        for row in report.rows:
            out = {name: report.value(row, name) for name in PREVIEW_COLUMNS if name in COLUMN_CANDIDATES}
            out["sensitivity_label"] = "; ".join(labels.display(v) for v in item_labels(report, row))
            out["encrypted"] = "yes" if _is_true(report.value(row, "encrypted")) else ""
            writer.writerow(out)
    return dest
