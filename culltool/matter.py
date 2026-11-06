"""A matter file (JSON) describes one culling job: the case, custodians, filters and export settings."""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from pathlib import Path

from .labels import LabelIndex
from .query import CullCriteria

MATTER_ID_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$")
EXPORT_FORMATS = {"pst", "msg"}
PARTIAL_SCOPES = {"responsiveLocations", "responsiveLocations, nonresponsiveLocations"}


class MatterError(ValueError):
    pass


@dataclass
class Custodian:
    email: str
    sites: list[str] = field(default_factory=list)


@dataclass
class ExportSettings:
    # Partially indexed items (encrypted, unsupported or oversized files) can't be keyword-searched.
    # Leaving them out of an export is a defensibility decision; make it deliberately, with counsel.
    include_partially_indexed: bool = True
    partially_indexed_scope: str = "responsiveLocations"
    format: str = "pst"
    additional_options: str = "none"  # e.g. "cloudAttachments, htmlTranscripts"; confirm what Everlaw expects


@dataclass
class Matter:
    matter_id: str
    case_name: str
    description: str
    custodians: list[Custodian]
    additional_sites: list[str]
    criteria: dict
    export: ExportSettings

    def build_criteria(self, labels: LabelIndex) -> CullCriteria:
        raw = dict(self.criteria)
        include_refs = raw.pop("labels", [])
        exclude_refs = raw.pop("exclude_labels", [])
        criteria = CullCriteria.from_dict(raw)
        criteria.label_ids = [gid for ref in include_refs for gid in labels.resolve(ref)]
        criteria.exclude_label_ids = [gid for ref in exclude_refs for gid in labels.resolve(ref)]
        criteria.normalize()
        return criteria


_TOP_KEYS = {"matter_id", "case_name", "description", "custodians", "additional_sites", "criteria", "export"}
_EXPORT_KEYS = {"include_partially_indexed", "partially_indexed_scope", "format", "additional_options"}


def load_matter(path: str | Path) -> Matter:
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    unknown = sorted(set(data) - _TOP_KEYS)
    if unknown:
        raise MatterError(f"Unknown matter field(s): {', '.join(unknown)}")
    matter_id = str(data.get("matter_id", ""))
    if not MATTER_ID_RE.match(matter_id):
        raise MatterError("matter_id is required: letters, digits, '.', '_' or '-' (max 64)")

    custodians = []
    for entry in data.get("custodians", []):
        if isinstance(entry, str):
            entry = {"email": entry}
        extra = set(entry) - {"email", "sites"}
        if extra:
            raise MatterError(f"Unknown custodian field(s): {sorted(extra)}")
        email = str(entry.get("email", "")).strip()
        if "@" not in email:
            raise MatterError(f"Custodian needs an email address: {entry!r}")
        custodians.append(Custodian(email, [_check_url(u) for u in entry.get("sites", [])]))
    if not custodians:
        raise MatterError("Add at least one custodian")

    export_raw = data.get("export", {})
    extra = set(export_raw) - _EXPORT_KEYS
    if extra:
        raise MatterError(f"Unknown export field(s): {sorted(extra)}")
    export = ExportSettings(**export_raw)
    if export.format not in EXPORT_FORMATS:
        raise MatterError(f"export.format must be one of {sorted(EXPORT_FORMATS)}")
    if export.partially_indexed_scope not in PARTIAL_SCOPES:
        raise MatterError(f"export.partially_indexed_scope must be one of {sorted(PARTIAL_SCOPES)}")

    criteria = data.get("criteria", {})
    # Validate the filters now (labels are resolved later, once label names can be looked up).
    CullCriteria.from_dict({k: v for k, v in criteria.items() if k not in ("labels", "exclude_labels")})

    return Matter(
        matter_id=matter_id,
        case_name=str(data.get("case_name") or matter_id),
        description=str(data.get("description", "")),
        custodians=custodians,
        additional_sites=[_check_url(u) for u in data.get("additional_sites", [])],
        criteria=criteria,
        export=export,
    )


def _check_url(url: str) -> str:
    if not str(url).startswith("https://"):
        raise MatterError(f"Site URLs must start with https://: {url!r}")
    return str(url).rstrip("/")
