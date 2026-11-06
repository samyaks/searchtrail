# 0011. PurviewGateway lives in the core package

- Status: Accepted
- Date: 2026-11-06

## Context
V1_PLAN 2 puts the gateway in `backend/app/microsoft/`. But the workflow and CLI (core package)
must call Purview through the same interface, and the core must not depend on the web app.

## Decision
- `backend/searchtrail/gateway.py`: the `PurviewGateway` Protocol (V1_PLAN 5.4, plus `source_url`
  and a blocking `wait_for_operation` for the CLI and tests) and `GatewayNotImplemented`.
- `backend/searchtrail/gateway_graph.py`: `GraphPurviewGateway`, wrapping `ediscovery.py`.
- `backend/searchtrail/gateway_dryrun.py`: `DryRunPurviewGateway`, over `DryRunTransport`.
- `backend/app/microsoft/`: picks the implementation for the web app (dry run now; per-user live
  gateway from WS-C).
- Not built live yet (raise `GatewayNotImplemented` naming the Graph call): `search_users`,
  `apply_hold`, `remove_hold`, `add_to_review_set`. All four work in dry run.
- `download_file` is implemented live by streaming the existing download logic, but is unverified
  against a tenant (V1_PLAN 8).

## Consequences
- WS-C owns `searchtrail/gateway_graph.py`, `gateway_dryrun.py`, `graph.py`, `dryrun.py` and
  `app/microsoft/`. `searchtrail/gateway.py` is a shared contract: changes only by approved PR.
- `CullWorkflow` takes a gateway, not a `GraphClient`.
