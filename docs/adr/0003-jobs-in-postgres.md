# 0003. Background jobs in a Postgres table

- Status: Accepted
- Date: 2026-11-06

## Context
Estimates take minutes and exports hours. Jobs must survive restarts, and customers install
SearchTrail themselves, so each extra service (Redis, a broker) is a cost.

## Decision
- A `jobs` table holds every long action (`estimate`, `preview`, `term_report`, `export`,
  `download`, `review_set`). The API inserts a row and returns `202` with the job (contract `Job`).
- The worker (`searchtrail-worker`, `app/jobs/worker.py`) claims the oldest due job with
  `SELECT ... FOR UPDATE SKIP LOCKED`, so several workers can run safely.
- Workers send heartbeats. On start, a worker requeues `running` jobs whose heartbeat is older than
  5 minutes.
- Jobs are resumable: right after starting a Purview operation, the handler saves its URL in
  `jobs.checkpoint`. A resumed job polls that operation instead of starting a new one.
- The frontend polls `GET /jobs/{id}` every 3 to 10 seconds.

## Consequences
- No new infrastructure; jobs are backed up with the database.
- Throughput is limited by polling (2 s by default), which is irrelevant next to Purview's speed.
- WS-B2 owns the handlers; Phase 0 registers none, so any job fails cleanly with "can't run ... yet".
