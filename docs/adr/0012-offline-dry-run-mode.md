# 0012. Offline mode: SEARCHTRAIL_DRY_RUN=1

- Status: Accepted
- Date: 2026-11-06

## Decision
`SEARCHTRAIL_DRY_RUN=1` makes the API and worker use `DryRunPurviewGateway`; the CLI uses `--dry-run`.
`DryRunTransport` answers every Graph call with plausible data (counts derived from the KQL, so
changing the query changes the numbers) and records each call for tests. Every new Purview call must
get a dry-run answer in the same PR. WS-H feeds recorded real responses into it so dry run matches
reality. `/health` and `/me` report `dry_run`, and the shell shows it.
