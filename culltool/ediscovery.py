"""The Microsoft Graph eDiscovery calls, one method per step.

Call sequence for a matter:
  1. ensure_case            POST /security/cases/ediscoveryCases
  2. ensure_custodian       POST .../custodians
  3. ensure_user_source     POST .../custodians/{id}/userSources        (mailbox + OneDrive)
     add_site_source        POST .../custodians/{id}/siteSources        (SharePoint sites)
  4. create_search          POST .../searches   (KQL + custodianSources@odata.bind)
     add_additional_site    POST .../searches/{id}/additionalSources   (sites with no custodian)
  5. estimate               POST .../searches/{id}/estimateStatistics  -> poll the operation
  6. export_report          POST .../searches/{id}/exportReport        -> item list, no content
  7. start_export           POST .../searches/{id}/exportResult        -> the package Everlaw imports
"""
from __future__ import annotations

from .graph import GraphClient, GraphError, Log

CASES = "/security/cases/ediscoveryCases"


def export_criteria(include_partially_indexed: bool) -> str:
    return "searchHits, partiallyIndexed" if include_partially_indexed else "searchHits"


class EDiscovery:
    def __init__(self, graph: GraphClient, log: Log = print):
        self.graph = graph
        self.log = log

    # 1. Case -----------------------------------------------------------------------------
    def ensure_case(self, name: str, description: str, external_id: str | None = None,
                    known_id: str | None = None) -> dict:
        if known_id:
            try:
                return self.graph.get(f"{CASES}/{known_id}")
            except GraphError as exc:
                if exc.status != 404:
                    raise
        for case in self.graph.get_all(CASES):
            if case.get("displayName") == name:
                return case
        body = {"displayName": name, "description": description}
        if external_id:
            body["externalId"] = external_id
        self.log(f"Creating eDiscovery case '{name}'")
        return self.graph.post(CASES, body).json

    # 2-3. Custodians and their data sources ---------------------------------------------
    def ensure_custodian(self, case_id: str, email: str) -> dict:
        path = f"{CASES}/{case_id}/custodians"
        for custodian in self.graph.get_all(path):
            if (custodian.get("email") or "").lower() == email.lower():
                return custodian
        self.log(f"Adding custodian {email}")
        return self.graph.post(path, {"email": email}).json

    def ensure_user_source(self, case_id: str, custodian_id: str, email: str,
                           included_sources: str = "mailbox, site") -> dict:
        """The custodian's mailbox and OneDrive."""
        path = f"{CASES}/{case_id}/custodians/{custodian_id}/userSources"
        for source in self.graph.get_all(path):
            if (source.get("email") or "").lower() == email.lower():
                return source
        return self.graph.post(path, {"email": email, "includedSources": included_sources}).json

    def add_site_source(self, case_id: str, custodian_id: str, web_url: str) -> dict:
        self.log(f"Adding site {web_url}")
        return self.graph.post(f"{CASES}/{case_id}/custodians/{custodian_id}/siteSources",
                               {"site": {"webUrl": web_url}}).json

    def source_url(self, case_id: str, custodian_id: str, collection: str, source_id: str) -> str:
        """Absolute URL of a data source, used for @odata.bind when creating a search."""
        return f"{self.graph.base_url}{CASES}/{case_id}/custodians/{custodian_id}/{collection}/{source_id}"

    # 4. Search ---------------------------------------------------------------------------
    def create_search(self, case_id: str, name: str, kql: str, source_urls: list[str], description: str = "") -> dict:
        body = {"displayName": name, "description": description, "contentQuery": kql, "dataSourceScopes": "none"}
        if source_urls:
            body["custodianSources@odata.bind"] = source_urls
        self.log(f"Creating search '{name}'")
        return self.graph.post(f"{CASES}/{case_id}/searches", body).json

    def add_additional_site(self, case_id: str, search_id: str, web_url: str) -> dict:
        return self.graph.post(
            f"{CASES}/{case_id}/searches/{search_id}/additionalSources",
            {"@odata.type": "microsoft.graph.security.siteSource", "site": {"webUrl": web_url}},
        ).json

    def update_query(self, case_id: str, search_id: str, kql: str) -> None:
        self.graph.patch(f"{CASES}/{case_id}/searches/{search_id}", {"contentQuery": kql})

    # 5-7. Long-running actions -------------------------------------------------------------
    def start_action(self, case_id: str, search_id: str, action: str, body: dict | None = None) -> str:
        """Start an estimate/report/export and return the URL of the operation to poll."""
        resp = self.graph.post(f"{CASES}/{case_id}/searches/{search_id}/{action}", body)
        location = resp.headers.get("Location")
        if not location:
            raise RuntimeError(f"{action} was accepted, but Graph returned no Location header to track it")
        return location

    def estimate(self, case_id: str, search_id: str) -> dict:
        url = self.start_action(case_id, search_id, "estimateStatistics")
        return self.graph.wait_for_operation(url, label="estimate")

    def export_report(self, case_id: str, search_id: str, name: str, *, include_partially_indexed: bool,
                      partially_indexed_scope: str = "responsiveLocations") -> dict:
        """Item-level metadata (item.csv) for the preview. No document contents leave Purview."""
        body = {
            "displayName": name,
            "description": "Culling preview: item list only",
            "exportCriteria": export_criteria(include_partially_indexed),
            "additionalOptions": "none",
        }
        if include_partially_indexed:
            body["exportLocation"] = partially_indexed_scope
        url = self.start_action(case_id, search_id, "exportReport", body)
        return self.graph.wait_for_operation(url, label="report")

    def start_export(self, case_id: str, search_id: str, name: str, description: str, *,
                     include_partially_indexed: bool, partially_indexed_scope: str,
                     export_format: str, additional_options: str) -> str:
        body = {
            "displayName": name,
            "description": description,
            "exportCriteria": export_criteria(include_partially_indexed),
            "exportFormat": export_format,
            "additionalOptions": additional_options,
        }
        if include_partially_indexed:
            body["exportLocation"] = partially_indexed_scope
        return self.start_action(case_id, search_id, "exportResult", body)
