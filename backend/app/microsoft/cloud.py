"""Which Microsoft cloud a Graph host belongs to."""
from __future__ import annotations

from urllib.parse import urlsplit

from app.schemas.contract import Cloud

_HOSTS = {
    "graph.microsoft.com": Cloud.COMMERCIAL,  # GCC uses the commercial host; it can't be told apart from here
    "graph.microsoft.us": Cloud.GCC_HIGH,
    "dod-graph.microsoft.us": Cloud.DOD,
}


def cloud_for(graph_base: str) -> Cloud:
    """The cloud for a Graph base URL, such as https://graph.microsoft.us/v1.0. Unknown hosts (a test
    stand-in, a proxy) count as commercial."""
    return _HOSTS.get((urlsplit(graph_base).hostname or "").lower(), Cloud.COMMERCIAL)
