"""GraphPurviewGateway: the live PurviewGateway, over Microsoft Graph (see gateway.py).

Wraps the existing calls in ediscovery.py. Methods that have no live implementation yet raise
GatewayNotImplemented with the Graph call they will make; WS-C builds them.
"""
from __future__ import annotations

from collections.abc import Callable
from typing import BinaryIO
from urllib.parse import urlsplit

from .ediscovery import EDiscovery, export_criteria
from .gateway import GatewayNotImplemented
from .graph import GraphClient, GraphError, Log
from .labels import LABELS_PATH

DOWNLOAD_CHUNK = 8 * 1024 * 1024


class UntrustedUrl(ValueError):
    """A URL that would receive the user's token is not one Microsoft gave us."""


class GraphPurviewGateway:
    def __init__(self, graph: GraphClient, download_token: Callable[[], str], log: Log = print):
        self.graph = graph
        self.download_token = download_token
        self.log = log
        self.ed = EDiscovery(graph, log)

    # -- case, custodians and data sources ----------------------------------------------------
    def ensure_case(self, name: str, description: str, external_id: str | None = None,
                    known_id: str | None = None) -> dict:
        return self.ed.ensure_case(name, description, external_id, known_id=known_id)

    def ensure_custodian(self, case_id: str, email: str) -> dict:
        return self.ed.ensure_custodian(case_id, email)

    def ensure_user_source(self, case_id: str, custodian_id: str, email: str,
                           included_sources: str = "mailbox, site") -> dict:
        return self.ed.ensure_user_source(case_id, custodian_id, email, included_sources)

    def add_site_source(self, case_id: str, custodian_id: str, web_url: str) -> dict:
        return self.ed.add_site_source(case_id, custodian_id, web_url)

    def source_url(self, case_id: str, custodian_id: str, collection: str, source_id: str) -> str:
        return self.ed.source_url(case_id, custodian_id, collection, source_id)

    # -- searches -------------------------------------------------------------------------------
    def create_search(self, case_id: str, name: str, kql: str, source_urls: list[str],
                      description: str = "") -> dict:
        return self.ed.create_search(case_id, name, kql, source_urls, description=description)

    def update_query(self, case_id: str, search_id: str, kql: str) -> None:
        self.ed.update_query(case_id, search_id, kql)

    def add_additional_site(self, case_id: str, search_id: str, web_url: str) -> dict:
        return self.ed.add_additional_site(case_id, search_id, web_url)

    # -- long-running actions -------------------------------------------------------------------
    def start_estimate(self, case_id: str, search_id: str) -> str:
        return self.ed.start_action(case_id, search_id, "estimateStatistics")

    def start_report(self, case_id: str, search_id: str, name: str, *, include_partially_indexed: bool,
                     partially_indexed_scope: str = "responsiveLocations") -> str:
        body = {
            "displayName": name,
            "description": "SearchTrail preview: item list only",
            "exportCriteria": export_criteria(include_partially_indexed),
            "additionalOptions": "none",
        }
        if include_partially_indexed:
            body["exportLocation"] = partially_indexed_scope
        return self.ed.start_action(case_id, search_id, "exportReport", body)

    def start_export(self, case_id: str, search_id: str, name: str, description: str, *,
                     include_partially_indexed: bool, partially_indexed_scope: str,
                     export_format: str, additional_options: str) -> str:
        return self.ed.start_export(case_id, search_id, name, description,
                                    include_partially_indexed=include_partially_indexed,
                                    partially_indexed_scope=partially_indexed_scope,
                                    export_format=export_format, additional_options=additional_options)

    def add_to_review_set(self, case_id: str, search_id: str, review_set_name: str) -> str:
        raise GatewayNotImplemented(
            "add_to_review_set",
            "POST /security/cases/ediscoveryCases/{case}/reviewSets (if missing), then "
            "POST .../reviewSets/{reviewSet}/addToReviewSet with search@odata.bind",
        )

    def _check_operation_url(self, url: str) -> str:
        """Operation URLs are stored (jobs table) and later sent the Graph token, so only accept
        URLs on the Graph host this gateway talks to."""
        want, got = urlsplit(self.graph.base_url), urlsplit(url)
        if (got.scheme, got.netloc) != (want.scheme, want.netloc):
            raise UntrustedUrl(f"Refusing to send the Graph token to {got.scheme}://{got.netloc}: "
                               f"operation URLs must be on {want.scheme}://{want.netloc}")
        return url

    def get_operation(self, url: str) -> dict:
        return self.graph.get(self._check_operation_url(url))

    def wait_for_operation(self, url: str, *, label: str = "operation") -> dict:
        return self.graph.wait_for_operation(self._check_operation_url(url), label=label)

    # -- files ----------------------------------------------------------------------------------
    def download_file(self, url: str, dest_stream: BinaryIO) -> int:
        """Not yet verified against a live tenant: check the download app ID and whether the
        X-AllowWithAADToken header is still needed (docs/V1_PLAN.md section 8)."""
        if urlsplit(url).scheme != "https":
            raise UntrustedUrl("Refusing to send the download token over a non-HTTPS URL")
        # TODO(WS-C): once WS-H records the real download hosts, allow only those.
        headers = {"Authorization": f"Bearer {self.download_token()}", "X-AllowWithAADToken": "true"}
        written = 0
        with self.graph.session.get(url, headers=headers, stream=True, timeout=self.graph.timeout) as r:
            if r.status_code >= 400:
                raise GraphError(r.status_code, "GET", url, r.text)
            for chunk in r.iter_content(chunk_size=DOWNLOAD_CHUNK):
                dest_stream.write(chunk)
                written += len(chunk)
        return written

    # -- holds ----------------------------------------------------------------------------------
    def apply_hold(self, case_id: str, custodian_id: str) -> dict:
        raise GatewayNotImplemented(
            "apply_hold", "POST /security/cases/ediscoveryCases/{case}/custodians/{custodian}/applyHold")

    def remove_hold(self, case_id: str, custodian_id: str) -> dict:
        raise GatewayNotImplemented(
            "remove_hold", "POST /security/cases/ediscoveryCases/{case}/custodians/{custodian}/removeHold")

    # -- directory ------------------------------------------------------------------------------
    def list_labels(self) -> list[dict]:
        return list(self.graph.get_all(LABELS_PATH))

    def search_users(self, q: str) -> list[dict]:
        raise GatewayNotImplemented(
            "search_users",
            'GET /users?$search="displayName:{q}" OR "mail:{q}"&$select=id,displayName,mail,department '
            "with ConsistencyLevel: eventual (needs User.ReadBasic.All)",
        )
