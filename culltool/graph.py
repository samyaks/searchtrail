"""A small Microsoft Graph client: retries, paging, long-running operations and file downloads.

Deliberately thin (requests only) so every HTTP call the tool makes is easy to see and audit.
"""
from __future__ import annotations

import random
import time
from dataclasses import dataclass
from pathlib import Path
from typing import TYPE_CHECKING, Any, Callable, Iterator, Mapping

import requests

if TYPE_CHECKING:
    from .dryrun import DryRunTransport

RETRY_STATUSES = {429, 500, 502, 503, 504}
TERMINAL_STATES = {"succeeded", "partiallySucceeded", "failed", "submissionFailed"}
FAILED_STATES = {"failed", "submissionFailed"}

Log = Callable[[str], None]


class GraphError(RuntimeError):
    """Graph returned an error that retrying won't fix."""

    def __init__(self, status: int, method: str, url: str, body: str):
        super().__init__(f"{method} {url} -> HTTP {status}\n{body[:2000]}")
        self.status = status
        self.body = body


class OperationFailed(RuntimeError):
    def __init__(self, operation: dict):
        super().__init__(
            f"Purview operation {operation.get('id')} ended with status {operation.get('status')}: "
            f"{operation.get('resultInfo') or 'no details returned'}"
        )
        self.operation = operation


@dataclass
class Response:
    status: int
    json: dict[str, Any]
    headers: Mapping[str, str]


class GraphClient:
    def __init__(
        self,
        base_url: str,
        token_fn: Callable[[], str] | None = None,
        *,
        transport: "DryRunTransport | None" = None,
        max_retries: int = 6,
        timeout: float = 60,
        log: Log = print,
        sleep: Callable[[float], None] = time.sleep,
    ):
        self.base_url = base_url.rstrip("/")
        self.token_fn = token_fn
        self.dry = transport
        self.max_retries = max_retries
        self.timeout = timeout
        self.log = log
        self.sleep = (lambda _seconds: None) if transport is not None else sleep
        self.session = requests.Session()

    def url(self, path_or_url: str) -> str:
        if path_or_url.startswith(("https://", "http://", "dry://")):
            return path_or_url
        return f"{self.base_url}{path_or_url}"

    def request(self, method: str, path_or_url: str, body: dict | None = None) -> Response:
        url = self.url(path_or_url)
        if self.dry is not None:
            return self.dry.handle(method, url, body)
        if self.token_fn is None:
            raise RuntimeError("GraphClient needs a token function outside dry-run mode")
        for attempt in range(self.max_retries + 1):
            r = self.session.request(
                method,
                url,
                json=body,
                timeout=self.timeout,
                headers={"Authorization": f"Bearer {self.token_fn()}", "Accept": "application/json"},
            )
            if r.status_code in RETRY_STATUSES and attempt < self.max_retries:
                delay = retry_delay(r.headers.get("Retry-After"), attempt)
                self.log(f"  Graph returned {r.status_code}; retrying in {delay:.0f}s")
                self.sleep(delay)
                continue
            if r.status_code >= 400:
                raise GraphError(r.status_code, method, url, r.text)
            data = r.json() if r.content and "json" in r.headers.get("Content-Type", "") else {}
            return Response(r.status_code, data, r.headers)
        raise RuntimeError("retry loop exited unexpectedly")

    def get(self, path: str) -> dict:
        return self.request("GET", path).json

    def post(self, path: str, body: dict | None = None) -> Response:
        return self.request("POST", path, body)

    def patch(self, path: str, body: dict) -> Response:
        return self.request("PATCH", path, body)

    def get_all(self, path: str) -> Iterator[dict]:
        """Yield every item of a collection, following @odata.nextLink pages."""
        next_url: str | None = path
        while next_url:
            page = self.get(next_url)
            yield from page.get("value", [])
            next_url = page.get("@odata.nextLink")

    def wait_for_operation(self, operation_url: str, *, timeout_s: float = 4 * 3600, label: str = "operation") -> dict:
        """Poll a Purview case operation (estimate, report, export) until it finishes."""
        delay, waited, last_pct = 5.0, 0.0, None
        while True:
            op = self.get(operation_url)
            status = op.get("status")
            pct = op.get("percentProgress")
            if pct is not None and pct != last_pct:
                self.log(f"  {label}: {status} ({pct}%)")
                last_pct = pct
            if status in TERMINAL_STATES:
                if status in FAILED_STATES:
                    raise OperationFailed(op)
                if status == "partiallySucceeded":
                    self.log(f"  WARNING: {label} only partially succeeded. Check the case in the Purview portal.")
                return op
            if waited >= timeout_s:
                raise TimeoutError(f"{label} still '{status}' after {timeout_s:.0f}s: {operation_url}")
            self.sleep(delay)
            waited += delay
            delay = min(30.0, delay * 1.5)

    def download(self, url: str, dest: Path, token: str) -> Path:
        """Download an export file. Uses the MicrosoftPurviewEDiscovery token, not the Graph one."""
        dest = Path(dest)
        dest.parent.mkdir(parents=True, exist_ok=True)
        if self.dry is not None:
            return self.dry.download(url, dest)
        # X-AllowWithAADToken is what community write-ups use for these links; confirm it's still needed.
        headers = {"Authorization": f"Bearer {token}", "X-AllowWithAADToken": "true"}
        with self.session.get(url, headers=headers, stream=True, timeout=self.timeout) as r:
            if r.status_code >= 400:
                raise GraphError(r.status_code, "GET", url, r.text)
            partial = dest.with_name(dest.name + ".part")
            with open(partial, "wb") as f:
                for chunk in r.iter_content(chunk_size=8 * 1024 * 1024):
                    f.write(chunk)
            partial.replace(dest)
        return dest


def retry_delay(retry_after: str | None, attempt: int) -> float:
    """Honour Retry-After when Graph sends it; otherwise back off exponentially with jitter."""
    if retry_after:
        try:
            return max(1.0, float(retry_after))
        except ValueError:
            pass
    return min(60.0, 2.0**attempt) + random.uniform(0, 1)
