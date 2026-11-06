"""DryRunPurviewGateway: the offline PurviewGateway (see gateway.py).

The same code as the live gateway, over DryRunTransport instead of the network, plus working
offline versions of the calls that have no live implementation yet. Every simulated Graph call is
recorded in `transport.calls`, so tests can assert on the exact requests.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import BinaryIO

from .dryrun import DryRunTransport
from .ediscovery import CASES
from .gateway_graph import GraphPurviewGateway
from .graph import GraphClient, Log

DEFAULT_GRAPH_BASE = "https://graph.microsoft.com/v1.0"


class DryRunPurviewGateway(GraphPurviewGateway):
    def __init__(self, transport: DryRunTransport | None = None, *, log: Log = print,
                 graph_base: str = DEFAULT_GRAPH_BASE, verbose: bool = False, state_file: Path | None = None):
        self.transport = transport or DryRunTransport(log=log, verbose=verbose, state_file=state_file)
        super().__init__(GraphClient(graph_base, transport=self.transport, log=log),
                         download_token=lambda: "dry-run-token", log=log)

    # -- offline versions of calls the live gateway doesn't implement yet ------------------------
    def add_to_review_set(self, case_id: str, search_id: str, review_set_name: str) -> str:
        path = f"{CASES}/{case_id}/reviewSets"
        existing = next((rs for rs in self.graph.get_all(path) if rs.get("displayName") == review_set_name), None)
        review_set = existing or self.graph.post(path, {"displayName": review_set_name}).json
        resp = self.graph.post(
            f"{path}/{review_set['id']}/addToReviewSet",
            {"search": {"id": search_id}, "additionalDataOptions": "linkedFiles"},
        )
        return resp.headers["Location"]

    def apply_hold(self, case_id: str, custodian_id: str) -> dict:
        resp = self.graph.post(f"{CASES}/{case_id}/custodians/{custodian_id}/applyHold")
        return {"custodian_id": custodian_id, "hold": "pending", "operation_url": resp.headers["Location"]}

    def remove_hold(self, case_id: str, custodian_id: str) -> dict:
        resp = self.graph.post(f"{CASES}/{case_id}/custodians/{custodian_id}/removeHold")
        return {"custodian_id": custodian_id, "hold": "releasing", "operation_url": resp.headers["Location"]}

    def search_users(self, q: str) -> list[dict]:
        needle = q.strip().lower()
        people = self.graph.get_all("/users")
        return [p for p in people
                if needle and needle in f"{p['displayName']} {p['mail']} {p.get('department') or ''}".lower()]

    def download_file(self, url: str, dest_stream: BinaryIO) -> int:
        with tempfile.TemporaryDirectory() as tmp:
            path = self.transport.download(url, Path(tmp) / "download.bin")
            data = path.read_bytes()
        dest_stream.write(data)
        return len(data)
