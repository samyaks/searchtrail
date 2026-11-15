# 0015. One Purview search per query version

- Status: Accepted
- Date: 2026-11-15

## Context
The jobs used one Purview search per set of sources, and patched its query to whichever version was
being estimated. A Purview operation (an export can take an hour) reads the search it was started on,
so estimating v4 while v3 exported rewrote the query under the export, and the log would say v3.
Locking the matter for the whole operation would stop every other job on it for that long.

## Decision
- **Each query version gets its own Purview search**, named `<matter number> query v<n>`, created with
  the version's KQL and sources and never changed. A version's query and sources never change, so
  nothing running on a search can be disturbed by work on another version.
- **Lost creates are found again by name** (`PurviewGateway.find_search`) before a search is made, so
  a timeout or a dead worker doesn't leave a second search for the same version.
- The matter lock (a Postgres advisory lock) covers only syncing the case and sources, not operations.
- The export check needs no write to Purview and no lock.
- The CLI keeps one search per matter, patched (it runs one command at a time).

## Consequences
- A Purview case holds one search per version estimated: more searches in the portal, each named
  after its version, which also makes the case match the matter's log version for version.
- The term report needs a search of its own per version too (its query is patched per term), so two
  term reports of one version must not run at once (WS-B2, PR 7).
