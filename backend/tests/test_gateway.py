"""The PurviewGateway interface and its two implementations."""
import inspect
import io

import pytest

from searchtrail.dryrun import DryRunTransport
from searchtrail.gateway import GatewayNotImplemented, PurviewGateway
from searchtrail.gateway_dryrun import DryRunPurviewGateway
from searchtrail.gateway_graph import GraphPurviewGateway
from searchtrail.graph import GraphClient

PROTOCOL_METHODS = sorted(
    name for name, member in inspect.getmembers(PurviewGateway, inspect.isfunction) if not name.startswith("_")
)


@pytest.fixture
def dry():
    return DryRunPurviewGateway(log=lambda _msg: None)


@pytest.fixture
def live():
    # No network: a client with no transport and a token function that must never be called.
    graph = GraphClient("https://graph.microsoft.com/v1.0", token_fn=lambda: pytest.fail("network used"))
    return GraphPurviewGateway(graph, download_token=lambda: "unused", log=lambda _msg: None)


def test_protocol_matches_the_plan():
    assert PROTOCOL_METHODS == sorted([
        "add_additional_site", "add_site_source", "add_to_review_set", "apply_hold", "create_search",
        "download_file", "ensure_case", "ensure_custodian", "ensure_user_source", "get_operation",
        "list_labels", "remove_hold", "search_users", "source_url", "start_estimate", "start_export",
        "start_report", "update_query", "wait_for_operation",
    ])


@pytest.mark.parametrize("cls", [GraphPurviewGateway, DryRunPurviewGateway])
def test_implementations_match_the_protocol_signatures(cls):
    for name in PROTOCOL_METHODS:
        expected = inspect.signature(getattr(PurviewGateway, name))
        actual = inspect.signature(getattr(cls, name))
        assert list(actual.parameters) == list(expected.parameters), f"{cls.__name__}.{name}"


def test_both_are_gateways(dry, live):
    assert isinstance(dry, PurviewGateway) and isinstance(live, PurviewGateway)


@pytest.mark.parametrize("method,args", [
    ("add_to_review_set", ("case", "search", "Relativity")),
    ("apply_hold", ("case", "custodian")),
    ("remove_hold", ("case", "custodian")),
    ("search_users", ("megan",)),
])
def test_unbuilt_live_calls_say_so_clearly(live, method, args):
    with pytest.raises(GatewayNotImplemented, match=rf"PurviewGateway\.{method} is not implemented.*SEARCHTRAIL_DRY_RUN=1"):
        getattr(live, method)(*args)


def test_long_actions_return_pollable_operations(dry):
    case = dry.ensure_case("M-1 test", "test")
    search = dry.create_search(case["id"], "s", "kickback", [])
    for url in (
        dry.start_estimate(case["id"], search["id"]),
        dry.start_report(case["id"], search["id"], "r", include_partially_indexed=True),
        dry.start_export(case["id"], search["id"], "e", "d", include_partially_indexed=False,
                         partially_indexed_scope="responsiveLocations", export_format="pst", additional_options="none"),
        dry.add_to_review_set(case["id"], search["id"], "Relativity v1"),
    ):
        assert "/operations/" in url
        assert dry.get_operation(url)["status"] == "succeeded"


def test_estimate_counts_and_report_download(dry):
    case = dry.ensure_case("M-1 test", "test")
    search = dry.create_search(case["id"], "s", "kickback", [])
    op = dry.wait_for_operation(dry.start_estimate(case["id"], search["id"]))
    assert op["indexedItemCount"] > 0
    report = dry.wait_for_operation(dry.start_report(case["id"], search["id"], "r", include_partially_indexed=False))
    buf = io.BytesIO()
    written = dry.download_file(report["exportFileMetadata"][0]["downloadUrl"], buf)
    assert written == len(buf.getvalue()) > 0 and buf.getvalue()[:2] == b"PK"  # a zip


def test_review_set_is_reused_by_name(dry):
    case = dry.ensure_case("M-1 test", "test")
    dry.add_to_review_set(case["id"], "search-1", "Relativity v1")
    dry.add_to_review_set(case["id"], "search-1", "Relativity v1")
    creates = [c for c in dry.transport.calls if c[0] == "POST" and c[1].endswith("/reviewSets")]
    assert len(creates) == 1


def test_holds_and_directory(dry):
    case = dry.ensure_case("M-1 test", "test")
    assert dry.apply_hold(case["id"], "custodian-1")["hold"] == "pending"
    assert dry.remove_hold(case["id"], "custodian-1")["hold"] == "releasing"
    assert [p["displayName"] for p in dry.search_users("fin")] == ["Megan Bowen", "Hannah Ortega"]
    assert dry.search_users("") == []


def test_labels(dry):
    names = [label["displayName"] for label in dry.list_labels()]
    assert names == ["Public", "General", "Confidential", "Highly Confidential"]


def test_dry_run_gateway_accepts_an_existing_transport():
    transport = DryRunTransport(verbose=False)
    gw = DryRunPurviewGateway(transport, log=lambda _msg: None)
    gw.list_labels()
    assert gw.transport is transport and transport.calls


def test_live_gateway_never_sends_tokens_to_other_hosts(live):
    from searchtrail.gateway_graph import UntrustedUrl

    for url in ("https://evil.example.com/operations/1", "http://graph.microsoft.com/v1.0/x"):
        with pytest.raises(UntrustedUrl):
            live.get_operation(url)
        with pytest.raises(UntrustedUrl):
            live.wait_for_operation(url)
    with pytest.raises(UntrustedUrl):
        live.download_file("http://example.com/export.zip", io.BytesIO())


def test_dry_run_works_against_any_graph_cloud():
    gw = DryRunPurviewGateway(log=lambda _m: None, graph_base="https://dod-graph.microsoft.us/v1.0")
    case = gw.ensure_case("M-1 test", "t")
    assert case["id"].startswith("case-")
    url = gw.start_estimate(case["id"], gw.create_search(case["id"], "s", "kickback", [])["id"])
    assert url.startswith("https://dod-graph.microsoft.us/v1.0/") and gw.get_operation(url)["status"] == "succeeded"
