"""PurviewGateway: the one interface between SearchTrail and Microsoft Purview eDiscovery.

Everything that talks to Microsoft goes through this interface, so the workflow, the jobs
worker and the API never call Graph directly. Two implementations:

  * GraphPurviewGateway   (gateway_graph.py)   live Microsoft Graph, as the signed-in user
  * DryRunPurviewGateway  (gateway_dryrun.py)  offline, backed by DryRunTransport

This file is a shared contract (docs/V1_PLAN.md section 5.4). Change it only through a small PR
approved by the integrator, with both implementations updated in the same PR.

Long-running actions (estimate, report, export, add to review set) return the URL of a Purview
operation. Callers store that URL and poll it with get_operation(), so a job can resume after a
worker restart. wait_for_operation() is a blocking convenience for the CLI and tests.
"""
from __future__ import annotations

from typing import BinaryIO, Protocol, runtime_checkable

# Fields of a Purview estimate operation that SearchTrail records.
COUNT_FIELDS = ("indexedItemCount", "indexedItemsSize", "unindexedItemCount", "unindexedItemsSize",
                "mailboxCount", "siteCount")


class GatewayNotImplemented(NotImplementedError):
    """A live Purview call that hasn't been built yet. The dry-run gateway has a working version."""

    def __init__(self, method: str, graph_call: str, owner: str = "WS-C"):
        super().__init__(
            f"PurviewGateway.{method} is not implemented for live Microsoft Graph yet ({owner} builds it). "
            f"It will call: {graph_call}. Run with SEARCHTRAIL_DRY_RUN=1 (or --dry-run) to use the offline version."
        )
        self.method = method


@runtime_checkable
class PurviewGateway(Protocol):
    """Purview eDiscovery operations, one method per step. All IDs are Purview (Graph) IDs."""

    # -- case, custodians and data sources ----------------------------------------------------
    def ensure_case(self, name: str, description: str, external_id: str | None = None,
                    known_id: str | None = None) -> dict:
        """Return the case with this ID (if given and it exists) or this display name, creating it if needed."""
        ...

    def ensure_custodian(self, case_id: str, email: str) -> dict:
        """Return the custodian with this email, adding them to the case if needed."""
        ...

    def ensure_user_source(self, case_id: str, custodian_id: str, email: str,
                           included_sources: str = "mailbox, site") -> dict:
        """The custodian's mailbox (and Teams chats) and OneDrive, as a user source."""
        ...

    def add_site_source(self, case_id: str, custodian_id: str, web_url: str) -> dict:
        """A SharePoint site linked to a custodian."""
        ...

    def source_url(self, case_id: str, custodian_id: str, collection: str, source_id: str) -> str:
        """Absolute URL of a data source, used to bind it to a search."""
        ...

    # -- searches -------------------------------------------------------------------------------
    def create_search(self, case_id: str, name: str, kql: str, source_urls: list[str],
                      description: str = "") -> dict:
        ...

    def update_query(self, case_id: str, search_id: str, kql: str) -> None:
        ...

    def add_additional_site(self, case_id: str, search_id: str, web_url: str) -> dict:
        """A SharePoint site with no custodian, added straight to a search."""
        ...

    # -- long-running actions: each returns the operation URL to poll --------------------------
    def start_estimate(self, case_id: str, search_id: str) -> str:
        ...

    def start_report(self, case_id: str, search_id: str, name: str, *, include_partially_indexed: bool,
                     partially_indexed_scope: str = "responsiveLocations") -> str:
        """Item-level report (metadata only, no content leaves Purview), for the preview."""
        ...

    def start_export(self, case_id: str, search_id: str, name: str, description: str, *,
                     include_partially_indexed: bool, partially_indexed_scope: str,
                     export_format: str, additional_options: str) -> str:
        ...

    def add_to_review_set(self, case_id: str, search_id: str, review_set_name: str) -> str:
        """Add a search's results to a review set (created if missing), for Relativity's Purview Sync."""
        ...

    def get_operation(self, url: str) -> dict:
        """Current state of an operation: status, percentProgress, and results when finished."""
        ...

    def wait_for_operation(self, url: str, *, label: str = "operation") -> dict:
        """Block until an operation finishes. For the CLI and tests; jobs poll get_operation instead."""
        ...

    # -- files ----------------------------------------------------------------------------------
    def download_file(self, url: str, dest_stream: BinaryIO) -> int:
        """Stream a report or export file into dest_stream; return the bytes written.
        Uses the MicrosoftPurviewEDiscovery token, not the Graph one."""
        ...

    # -- holds ----------------------------------------------------------------------------------
    def apply_hold(self, case_id: str, custodian_id: str) -> dict:
        ...

    def remove_hold(self, case_id: str, custodian_id: str) -> dict:
        ...

    # -- directory ------------------------------------------------------------------------------
    def list_labels(self) -> list[dict]:
        """Sensitivity labels as Graph returns them (nested sublabels or flat with parent IDs)."""
        ...

    def search_users(self, q: str) -> list[dict]:
        """People in the directory: dicts with id, displayName, mail, department."""
        ...


def counts_from_operation(op: dict) -> dict:
    """The count fields of a finished estimate operation."""
    return {k: op.get(k) for k in COUNT_FIELDS}
