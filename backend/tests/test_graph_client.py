"""GraphClient's retries: what it repeats on its own, and what it leaves to the caller."""
from __future__ import annotations

import pytest

from searchtrail.graph import GraphClient, GraphError


class FakeResponse:
    def __init__(self, status: int, body: str = "{}", headers: dict | None = None):
        self.status_code, self.text, self.content = status, body, body.encode()
        self.headers = {"Content-Type": "application/json", **(headers or {})}

    def json(self):
        import json

        return json.loads(self.text)


class FakeSession:
    """Answers with the given statuses in turn, recording each request."""

    def __init__(self, *statuses: int):
        self.statuses, self.sent = list(statuses), []

    def request(self, method, url, **_kwargs):
        self.sent.append((method, url))
        return FakeResponse(self.statuses.pop(0), headers={"Retry-After": "1"})


def client(*statuses: int) -> tuple[GraphClient, FakeSession, list[float]]:
    slept: list[float] = []
    graph = GraphClient("https://graph.microsoft.com/v1.0", token_fn=lambda: "token", log=lambda _m: None,
                        sleep=slept.append)
    graph.session = FakeSession(*statuses)
    return graph, graph.session, slept


@pytest.mark.parametrize("status", [429, 500, 502, 503, 504])
def test_reads_and_patches_are_retried_on_any_passing_failure(status):
    for method in ("GET", "PATCH"):
        graph, session, slept = client(status, 200)
        assert graph.request(method, "/security/cases/ediscoveryCases").status == 200
        assert len(session.sent) == 2 and slept == [1.0]


@pytest.mark.parametrize("status", [429, 503])
def test_a_post_graph_says_it_did_not_carry_out_is_sent_again(status):
    graph, session, _ = client(status, 201)
    assert graph.post("/security/cases/ediscoveryCases/c/searches", {"displayName": "s"}).status == 201
    assert len(session.sent) == 2


@pytest.mark.parametrize("status", [500, 502, 504])
def test_a_post_that_may_have_been_carried_out_is_not_sent_twice(status):
    """A 504 on POST .../searches can mean the search was made and only the answer was lost: a second
    POST would make a second search. The caller gets the error and decides."""
    graph, session, slept = client(status, 201)
    with pytest.raises(GraphError) as raised:
        graph.post("/security/cases/ediscoveryCases/c/searches/s/exportResult", {"displayName": "e"})
    assert raised.value.status == status and len(session.sent) == 1 and slept == []


def test_retries_stop_after_max_retries():
    graph, session, _ = client(*[503] * 3)
    graph.max_retries = 2
    with pytest.raises(GraphError):
        graph.get("/security/cases/ediscoveryCases")
    assert len(session.sent) == 3
