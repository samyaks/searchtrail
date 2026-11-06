"""Turn culling filters into a Purview eDiscovery KQL query, and explain it in plain English.

The main design rule: every filter applies only to the item types it makes sense for.
A naive query that ANDs "participants:acme.com" onto everything silently drops every
document, because documents have no participants. Here each item type (emails, chats,
documents) gets its own clause, with only the filters that apply to it.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field, fields, replace
from datetime import date
from typing import Callable

GUID_RE = re.compile(r"^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$")
_SIMPLE_TERM_RE = re.compile(r"^\w+\*?$", re.UNICODE)
_DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_EXT_RE = re.compile(r"^[a-z0-9]{1,10}$")
_DOMAIN_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
KQL_OPERATORS = {"AND", "OR", "NOT", "NEAR", "ONEAR"}

KIND_CLAUSES = {
    "email": "kind:email",
    # Teams chats and channel messages. Check this against your tenant: some content is kind:im.
    "chats": "(kind:microsoftteams OR kind:im)",
    "docs": "kind:docs",
}
KIND_NAMES = {"email": "emails", "chats": "Teams chats", "docs": "documents"}
MESSAGE_KINDS = {"email", "chats"}
DOC_DATE_PROPERTIES = {"lastmodifiedtime": "last modified", "created": "created"}
# Conservative default. Purview has query-length limits that differ by location; check current docs.
DEFAULT_MAX_QUERY_CHARS = 4000


class CriteriaError(ValueError):
    """The culling filters are invalid. Raised before anything is sent to Microsoft."""


@dataclass
class CullCriteria:
    keywords: list[str] = field(default_factory=list)
    keyword_mode: str = "any"  # "any" (OR) or "all" (AND)
    exclude_keywords: list[str] = field(default_factory=list)
    date_from: str | None = None  # YYYY-MM-DD, inclusive
    date_to: str | None = None  # YYYY-MM-DD, inclusive
    kinds: list[str] = field(default_factory=lambda: ["email", "chats", "docs"])
    file_extensions: list[str] = field(default_factory=list)  # documents only
    participant_domains: list[str] = field(default_factory=list)  # emails and chats only
    exclude_participant_domains: list[str] = field(default_factory=list)  # emails and chats only
    label_ids: list[str] = field(default_factory=list)
    exclude_label_ids: list[str] = field(default_factory=list)
    doc_date_property: str = "lastmodifiedtime"
    raw_kql: str | None = None  # expert escape hatch, ANDed onto everything

    @classmethod
    def from_dict(cls, data: dict) -> "CullCriteria":
        known = {f.name for f in fields(cls)}
        unknown = sorted(set(data) - known)
        if unknown:
            # Fail loudly on typos: a misspelled filter silently ignored is a culling error.
            raise CriteriaError(f"Unknown criteria field(s): {', '.join(unknown)}. Allowed: {', '.join(sorted(known))}")
        criteria = cls(**data)
        criteria.normalize()
        return criteria

    def normalize(self) -> None:
        self.keyword_mode = self.keyword_mode.strip().lower()
        self.kinds = list(dict.fromkeys(k.strip().lower() for k in self.kinds))
        self.file_extensions = [e.strip().lower().lstrip(".") for e in self.file_extensions]
        self.participant_domains = [d.strip().lower().lstrip("@") for d in self.participant_domains]
        self.exclude_participant_domains = [d.strip().lower().lstrip("@") for d in self.exclude_participant_domains]
        self.label_ids = list(dict.fromkeys(g.strip().lower() for g in self.label_ids))
        self.exclude_label_ids = list(dict.fromkeys(g.strip().lower() for g in self.exclude_label_ids))
        self.doc_date_property = self.doc_date_property.strip().lower()
        self.check()

    def check(self) -> None:
        if self.keyword_mode not in ("any", "all"):
            raise CriteriaError("keyword_mode must be 'any' or 'all'")
        if not self.kinds:
            raise CriteriaError("Choose at least one item type in 'kinds' (email, chats, docs)")
        bad = [k for k in self.kinds if k not in KIND_CLAUSES]
        if bad:
            raise CriteriaError(f"Unknown kinds: {bad}. Use email, chats or docs")
        start = _parse_date(self.date_from, "date_from")
        end = _parse_date(self.date_to, "date_to")
        if start and end and start > end:
            raise CriteriaError(f"date_from ({self.date_from}) is after date_to ({self.date_to})")
        for ext in self.file_extensions:
            if not _EXT_RE.match(ext):
                raise CriteriaError(f"Invalid file extension: {ext!r}")
        for domain in self.participant_domains + self.exclude_participant_domains:
            if not _DOMAIN_RE.match(domain):
                raise CriteriaError(f"Invalid domain: {domain!r}")
        for gid in self.label_ids + self.exclude_label_ids:
            if not GUID_RE.match(gid):
                raise CriteriaError(f"Label IDs must be GUIDs: {gid!r}")
        overlap = set(self.label_ids) & set(self.exclude_label_ids)
        if overlap:
            raise CriteriaError(f"Labels both included and excluded: {sorted(overlap)}")
        if self.doc_date_property not in DOC_DATE_PROPERTIES:
            raise CriteriaError(f"doc_date_property must be one of {sorted(DOC_DATE_PROPERTIES)}")
        for term in self.keywords + self.exclude_keywords:
            quote_term(term)
        if self.file_extensions and "docs" not in self.kinds:
            raise CriteriaError("file_extensions only apply to documents; add 'docs' to kinds or remove them")
        if (self.participant_domains or self.exclude_participant_domains) and not (MESSAGE_KINDS & set(self.kinds)):
            raise CriteriaError("Domain filters only apply to emails and chats; add one of those to kinds")
        if self.raw_kql is not None and not self.raw_kql.strip():
            raise CriteriaError("raw_kql is empty; remove it or give a query")


def _parse_date(value: str | None, name: str) -> date | None:
    if value is None:
        return None
    if not _DATE_RE.match(value):
        raise CriteriaError(f"{name} must look like YYYY-MM-DD, got {value!r}")
    try:
        return date.fromisoformat(value)
    except ValueError as exc:
        raise CriteriaError(f"{name} is not a real date: {value!r}") from exc


def quote_term(term: str) -> str:
    """Make one search term safe for KQL: single words stay bare, anything else becomes a phrase."""
    t = term.strip()
    if not t:
        raise CriteriaError("Empty search term")
    if t.startswith('"') or t.endswith('"'):
        if not (len(t) >= 2 and t.startswith('"') and t.endswith('"')) or '"' in t[1:-1] or not t[1:-1].strip():
            raise CriteriaError(f"Unbalanced quotes in term: {term!r}")
        t = t[1:-1].strip()
    elif '"' in t:
        raise CriteriaError(f"Quotes must wrap the whole term: {term!r}")
    if "*" in t:
        if t.startswith("*"):
            raise CriteriaError(f"Leading wildcards aren't supported in eDiscovery: {term!r}")
        if not _SIMPLE_TERM_RE.match(t):
            raise CriteriaError(f"Wildcards only work at the end of a single word: {term!r}")
        return t
    if _SIMPLE_TERM_RE.match(t) and t.upper() not in KQL_OPERATORS:
        return t
    return f'"{t}"'


def _group(parts: list[str], op: str) -> str:
    parts = [p for p in parts if p]
    if not parts:
        return ""
    if len(parts) == 1:
        return parts[0]
    return "(" + f" {op} ".join(parts) + ")"


def _range(prop: str, start: str | None, end: str | None) -> str:
    bounds = []
    if start:
        bounds.append(f"{prop}>={start}")
    if end:
        bounds.append(f"{prop}<={end}")
    return _group(bounds, "AND")


def _dates(props: list[str], c: CullCriteria) -> str:
    if not (c.date_from or c.date_to):
        return ""
    return _group([_range(p, c.date_from, c.date_to) for p in props], "OR")


def _kind_clause(kind: str, c: CullCriteria) -> str:
    parts = [KIND_CLAUSES[kind]]
    if kind in MESSAGE_KINDS:
        parts.append(_dates(["sent", "received"], c))
        parts.append(_group([f"participants:{d}" for d in c.participant_domains], "OR"))
        parts += [f"NOT participants:{d}" for d in c.exclude_participant_domains]
    else:
        parts.append(_dates([c.doc_date_property], c))
        parts.append(_group([f"fileextension:{e}" for e in c.file_extensions], "OR"))
    return _group(parts, "AND")


def build_kql(c: CullCriteria) -> str:
    clauses = [
        _group([quote_term(k) for k in c.keywords], "OR" if c.keyword_mode == "any" else "AND"),
        _group([f"InformationProtectionLabelId:{g}" for g in c.label_ids], "OR"),
        _group([_kind_clause(k, c) for k in c.kinds], "OR"),
    ]
    clauses += [f"NOT InformationProtectionLabelId:{g}" for g in c.exclude_label_ids]
    if c.exclude_keywords:
        clauses.append("NOT " + _group([quote_term(k) for k in c.exclude_keywords], "OR"))
    if c.raw_kql:
        clauses.append(f"({c.raw_kql.strip()})")
    return " AND ".join(p for p in clauses if p)


def term_queries(c: CullCriteria) -> list[tuple[str, str]]:
    """One query per keyword, each keeping every other filter, for a search-term hit report."""
    return [(term, build_kql(replace(c, keywords=[term], keyword_mode="any"))) for term in c.keywords]


def validate(c: CullCriteria, kql: str, max_chars: int = DEFAULT_MAX_QUERY_CHARS) -> list[str]:
    """Things that are allowed but worth a second look before running."""
    warnings = []
    if len(kql) > max_chars:
        warnings.append(f"Query is {len(kql)} characters; Purview may reject long queries (limit set to {max_chars}).")
    for term in c.keywords + c.exclude_keywords:
        stem = quote_term(term)
        if stem.endswith("*") and len(stem) - 1 < 3:
            warnings.append(f"Wildcard {stem!r} has a very short stem and may match a huge number of items.")
    if not (c.keywords or c.label_ids or c.date_from or c.date_to or c.raw_kql):
        warnings.append("No keywords, labels, dates or raw KQL: this search is very broad.")
    if c.participant_domains and "docs" in c.kinds:
        warnings.append("Domain filters apply to emails and chats only. Documents are not filtered by domain.")
    if c.label_ids:
        warnings.append("A label filter is set, so items without a sensitivity label are excluded.")
    return warnings


def describe(c: CullCriteria, label_name: Callable[[str], str] = lambda g: g) -> str:
    """Plain-English statement of the culling method, suitable for a methodology memo."""
    lines = ["Item types: " + ", ".join(KIND_NAMES[k] for k in c.kinds) + "."]
    if c.date_from or c.date_to:
        span = f"from {c.date_from}" if c.date_from else ""
        span += (" " if span else "") + (f"to {c.date_to}" if c.date_to else "onward")
        basis = []
        if MESSAGE_KINDS & set(c.kinds):
            basis.append("emails/chats by sent or received date")
        if "docs" in c.kinds:
            basis.append(f"documents by {DOC_DATE_PROPERTIES[c.doc_date_property]} date")
        lines.append(f"Date range {span} (inclusive): " + "; ".join(basis) + ".")
    if c.keywords:
        mode = "ANY" if c.keyword_mode == "any" else "ALL"
        lines.append(f"Containing {mode} of these terms: " + ", ".join(quote_term(k) for k in c.keywords) + ".")
        if any(quote_term(k).endswith("*") for k in c.keywords):
            lines.append("Terms ending in * match any word starting with that stem.")
    if c.exclude_keywords:
        lines.append("Excluding items containing any of: " + ", ".join(quote_term(k) for k in c.exclude_keywords) + ".")
    if c.participant_domains:
        lines.append("Emails/chats limited to those with a participant at: " + ", ".join(c.participant_domains)
                     + ". Documents are not filtered by domain.")
    if c.exclude_participant_domains:
        lines.append("Emails/chats excluded if a participant is at: " + ", ".join(c.exclude_participant_domains) + ".")
    if c.file_extensions:
        lines.append("Documents limited to file types: " + ", ".join(c.file_extensions) + ".")
    if c.label_ids:
        lines.append("Only items with these sensitivity labels: " + ", ".join(label_name(g) for g in c.label_ids)
                     + ". Items without a label are excluded.")
    if c.exclude_label_ids:
        lines.append("Excluding items with these sensitivity labels: " + ", ".join(label_name(g) for g in c.exclude_label_ids) + ".")
    if c.raw_kql:
        lines.append(f"Additional expert query (ANDed): {c.raw_kql.strip()}")
    return "\n".join(lines)
