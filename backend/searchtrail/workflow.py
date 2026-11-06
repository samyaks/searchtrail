"""The culling workflow: prepare -> preview -> (term report) -> export to Everlaw.

Defensibility rules built in:
  * Purview does the collection. This tool never downloads document contents.
  * The preview comes from the same Purview search that gets exported, so they match.
  * An export is refused unless that exact query and set of sources was previewed first,
    and counts are re-checked right before exporting.
  * Every step goes into a hash-chained log with the KQL, the filters and the counts.
"""
from __future__ import annotations

import json
from dataclasses import asdict, dataclass, field
from datetime import UTC, datetime
from pathlib import Path

from .audit import AuditLog, canonical, sha256_text
from .gateway import COUNT_FIELDS, PurviewGateway, counts_from_operation
from .graph import Log
from .labels import LabelIndex
from .matter import Matter
from .query import CullCriteria, build_kql, describe, term_queries, validate
from .report import load_report, summarize, write_preview_csv

__all__ = ["COUNT_FIELDS", "CullWorkflow", "CustodianSources", "ExportBlocked", "Prepared", "PurviewTarget",
           "Synced", "sources_signature", "sync_purview"]
DRIFT_FIELDS = ("indexedItemCount", "unindexedItemCount")


class ExportBlocked(RuntimeError):
    """The export would not match what was previewed."""


@dataclass
class Prepared:
    case_id: str
    case_name: str
    search_id: str
    search_name: str
    kql: str
    criteria: CullCriteria
    warnings: list[str]
    source_urls: list[str]


def _stamp() -> str:
    return datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")


# -- syncing Purview to a matter (shared by the CLI and the web app's jobs) ---------------------
@dataclass
class CustodianSources:
    email: str
    sites: list[str] = field(default_factory=list)
    # What the custodian's user source covers: "mailbox" (mail and Teams chats), "site" (OneDrive).
    # Empty means no user source, only the linked sites.
    included_sources: str = "mailbox, site"


@dataclass
class PurviewTarget:
    """What the Purview case and search must look like."""

    matter_number: str
    case_name: str
    description: str
    custodians: list[CustodianSources]
    additional_sites: list[str]
    kql: str


@dataclass
class Synced:
    case_id: str
    search_id: str
    search_name: str
    source_urls: list[str]


def sync_purview(gw: PurviewGateway, state: dict, target: PurviewTarget) -> Synced:
    """Make sure the case, custodians, data sources and search exist and match `target`, creating only
    what's missing. `state` remembers the Purview IDs between runs (the CLI keeps it in state.json, the
    web app in matters.purview_state) and is updated in place; save it as soon as this returns.

    Same sources as last time: the existing search is reused and its query patched if it changed.
    Different sources: a new search, numbered, and the earlier ones stay in the case as a record.

    Not idempotent for site sources and searches: if the process dies between creating one and saving
    `state`, a rerun creates another. Harmless (an unused source or search in the case), and rare.
    """
    case = gw.ensure_case(target.case_name, target.description, target.matter_number, known_id=state.get("case_id"))
    case_id = case["id"]
    if state.get("case_id") != case_id:
        state.clear()
        state["case_id"] = case_id

    custodians = state.setdefault("custodians", {})
    source_urls: list[str] = []
    for cust in target.custodians:
        entry = custodians.get(cust.email.lower())
        if not entry:
            c = gw.ensure_custodian(case_id, cust.email)
            entry = custodians[cust.email.lower()] = {"custodian_id": c["id"], "sites": {}}
        if cust.included_sources and (not entry.get("user_source_id")
                                      or entry.get("included_sources", "mailbox, site") != cust.included_sources):
            us = gw.ensure_user_source(case_id, entry["custodian_id"], cust.email, cust.included_sources)
            entry["user_source_id"], entry["included_sources"] = us["id"], cust.included_sources
        if cust.included_sources:
            source_urls.append(gw.source_url(case_id, entry["custodian_id"], "userSources", entry["user_source_id"]))
        for site in cust.sites:
            if site not in entry["sites"]:
                entry["sites"][site] = gw.add_site_source(case_id, entry["custodian_id"], site)["id"]
            source_urls.append(gw.source_url(case_id, entry["custodian_id"], "siteSources", entry["sites"][site]))

    fingerprint = sha256_text(canonical({"sources": sorted(source_urls), "sites": sorted(target.additional_sites)}))
    search = state.get("search")
    if search and search.get("fingerprint") == fingerprint:
        if search["kql"] != target.kql:
            gw.update_query(case_id, search["id"], target.kql)
            search["kql"] = target.kql
    else:
        history = state.setdefault("search_history", [])
        name = f"{target.matter_number} cull v{len(history) + 1}"
        created = gw.create_search(case_id, name, target.kql, source_urls,
                                   description="Created by SearchTrail; see the matter's culling log")
        for site in target.additional_sites:
            gw.add_additional_site(case_id, created["id"], site)
        search = state["search"] = {"id": created["id"], "name": name, "fingerprint": fingerprint, "kql": target.kql}
        history.append({"id": created["id"], "name": name, "created": _stamp()})
        state.pop("term_search", None)
    return Synced(case_id, search["id"], search["name"], source_urls)


_counts = counts_from_operation


def sources_signature(matter: Matter) -> str:
    """Fingerprint of who and where is searched, computed from the matter file alone (no API calls)."""
    return sha256_text(canonical({
        "custodians": sorted([c.email.lower(), sorted(c.sites)] for c in matter.custodians),
        "additional_sites": sorted(matter.additional_sites),
    }))


class CullWorkflow:
    def __init__(self, gateway: PurviewGateway, labels: LabelIndex, state_root: Path, actor: str, log: Log = print):
        self.gw = gateway
        self.labels = labels
        self.state_root = Path(state_root)
        self.actor = actor
        self.log = log

    def _estimate(self, case_id: str, search_id: str) -> dict:
        return self.gw.wait_for_operation(self.gw.start_estimate(case_id, search_id), label="estimate")

    def _download(self, url: str, dest: Path) -> Path:
        dest.parent.mkdir(parents=True, exist_ok=True)
        partial = dest.with_name(dest.name + ".part")
        with open(partial, "wb") as f:
            self.gw.download_file(url, f)
        partial.replace(dest)
        return dest

    # -- local state ---------------------------------------------------------------------------
    def matter_dir(self, matter: Matter) -> Path:
        return self.state_root / matter.matter_id

    def audit(self, matter: Matter) -> AuditLog:
        return AuditLog(self.matter_dir(matter) / "audit.jsonl")

    def _load_state(self, matter: Matter) -> dict:
        path = self.matter_dir(matter) / "state.json"
        return json.loads(path.read_text(encoding="utf-8")) if path.exists() else {}

    def _save_state(self, matter: Matter, state: dict) -> None:
        path = self.matter_dir(matter) / "state.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_text(json.dumps(state, indent=2), encoding="utf-8")

    # -- steps ---------------------------------------------------------------------------------
    def plan(self, matter: Matter) -> tuple[str, CullCriteria, list[str], str]:
        """KQL, filters, warnings and methodology text, without touching the case."""
        criteria = matter.build_criteria(self.labels)
        kql = build_kql(criteria)
        return kql, criteria, validate(criteria, kql), describe(criteria, self.labels.name_for)

    def prepare(self, matter: Matter) -> Prepared:
        """Make sure the case, custodians, data sources and search exist and match the matter file."""
        kql, criteria, warnings, _ = self.plan(matter)
        state = self._load_state(matter)
        target = PurviewTarget(
            matter_number=matter.matter_id, case_name=matter.case_name, description=matter.description,
            custodians=[CustodianSources(c.email, list(c.sites)) for c in matter.custodians],
            additional_sites=list(matter.additional_sites), kql=kql,
        )
        synced = sync_purview(self.gw, state, target)
        self._save_state(matter, state)
        return Prepared(synced.case_id, matter.case_name, synced.search_id, synced.search_name, kql, criteria,
                        warnings, synced.source_urls)

    def preview(self, matter: Matter, *, with_report: bool = True) -> dict:
        p = self.prepare(matter)
        self.log(f"Estimating '{p.search_name}'...")
        counts = _counts(self._estimate(p.case_id, p.search_id))
        result: dict = {"case_id": p.case_id, "search_id": p.search_id, "search_name": p.search_name,
                        "kql": p.kql, "warnings": p.warnings, "counts": counts}
        if with_report:
            stamp = _stamp()
            self.log("Building the item report (metadata only)...")
            op_url = self.gw.start_report(p.case_id, p.search_id, f"{matter.matter_id} preview {stamp}",
                                          include_partially_indexed=matter.export.include_partially_indexed,
                                          partially_indexed_scope=matter.export.partially_indexed_scope)
            op = self.gw.wait_for_operation(op_url, label="report")
            out_dir = self.matter_dir(matter) / "previews" / stamp
            files = [self._download(f["downloadUrl"], out_dir / f["fileName"]) for f in op.get("exportFileMetadata") or []]
            report = load_report(files)
            result.update(
                report_summary=summarize(report, self.labels),
                preview_csv=str(write_preview_csv(report, self.labels, out_dir / "preview.csv")),
                column_map=report.column_map,
                unmapped_columns=report.unmapped,
            )
        self.audit(matter).append(
            action="preview", actor=self.actor, matter_id=matter.matter_id, case_id=p.case_id,
            search_id=p.search_id, search_name=p.search_name, kql=p.kql, kql_sha256=sha256_text(p.kql),
            sources_sha256=sources_signature(matter), criteria=asdict(p.criteria), counts=counts,
            report_items=(result.get("report_summary") or {}).get("items"),
        )
        return result

    def term_report(self, matter: Matter) -> list[dict]:
        """Hits per search term, each within all the other filters. Uses a separate search."""
        p = self.prepare(matter)
        if not p.criteria.keywords:
            raise ValueError("This matter has no keywords, so there is nothing to report on")
        state = self._load_state(matter)
        term_search = state.get("term_search")
        if not term_search:
            created = self.gw.create_search(p.case_id, f"{matter.matter_id} term report", p.kql, p.source_urls,
                                            description="Per-term hit counts (SearchTrail)")
            for site in matter.additional_sites:
                self.gw.add_additional_site(p.case_id, created["id"], site)
            term_search = state["term_search"] = {"id": created["id"]}
            self._save_state(matter, state)

        rows = []
        queries = term_queries(p.criteria) + [("(all terms combined)", p.kql)]
        for term, kql in queries:
            self.log(f"Counting: {term}")
            self.gw.update_query(p.case_id, term_search["id"], kql)
            est = self._estimate(p.case_id, term_search["id"])
            rows.append({"term": term, "items": est.get("indexedItemCount"), "size_bytes": est.get("indexedItemsSize")})
        self.audit(matter).append(action="term_report", actor=self.actor, matter_id=matter.matter_id,
                                  case_id=p.case_id, kql_sha256=sha256_text(p.kql), rows=rows)
        return rows

    def export(self, matter: Matter, *, confirm: bool = False, accept_changes: bool = False, wait: bool = False) -> dict:
        not_previewed = ExportBlocked("This exact query and set of sources hasn't been previewed. Run 'preview' "
                                      "first, so the export matches what was reviewed.")
        log = self.audit(matter)
        last = log.last("preview")
        kql, *_ = self.plan(matter)
        # Checked before prepare(), so a blocked export never changes anything in Purview.
        if (not last or last.get("kql_sha256") != sha256_text(kql)
                or last.get("sources_sha256") != sources_signature(matter)):
            raise not_previewed
        p = self.prepare(matter)
        if last.get("search_id") != p.search_id:
            raise not_previewed

        self.log("Re-checking counts against the preview...")
        now = _counts(self._estimate(p.case_id, p.search_id))
        before = last.get("counts") or {}
        changes = {k: {"preview": before.get(k), "now": now.get(k)} for k in DRIFT_FIELDS if before.get(k) != now.get(k)}
        if changes and not accept_changes:
            raise ExportBlocked(f"Counts changed since the preview at {last.get('ts')}: {changes}. Run 'preview' "
                                "again, or pass --accept-changes to export anyway (this is logged).")

        name = f"{matter.matter_id} EVERLAW {_stamp()}"
        if not confirm:
            return {"confirmed": False, "export_name": name, "counts": now, "changes": changes}

        settings = matter.export
        op_url = self.gw.start_export(
            p.case_id, p.search_id, name, f"For Everlaw review. Previewed {last.get('ts')} by {last.get('actor')}.",
            include_partially_indexed=settings.include_partially_indexed,
            partially_indexed_scope=settings.partially_indexed_scope,
            export_format=settings.format, additional_options=settings.additional_options,
        )
        log.append(action="export_started", actor=self.actor, matter_id=matter.matter_id, case_id=p.case_id,
                   search_id=p.search_id, kql_sha256=sha256_text(p.kql), export_name=name, operation_url=op_url,
                   export_settings=asdict(settings), counts=now, preview_seq=last.get("seq"),
                   changes_accepted=changes or None)
        result = {"confirmed": True, "export_name": name, "operation_url": op_url, "counts": now,
                  "case_name": p.case_name}
        if wait:
            op = self.gw.wait_for_operation(op_url, label="export")
            files = [f.get("fileName") for f in op.get("exportFileMetadata") or []]
            log.append(action="export_finished", actor=self.actor, matter_id=matter.matter_id,
                       export_name=name, status=op.get("status"), files=files)
            result.update(status=op.get("status"), files=files)
        return result
