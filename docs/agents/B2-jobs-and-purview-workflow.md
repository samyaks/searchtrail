# WS-B2 · Jobs and Purview workflow

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `backend/app/jobs/`, `backend/searchtrail/workflow.py`, `backend/app/storage/`.
**Do not edit:** `backend/app/api/`, `backend/app/db/` (B1; ask for columns you need), `backend/searchtrail/gateway*.py`, `graph.py`, `dryrun.py` (C), `frontend/`, `deploy/`, except through a PR note to the owner.

## Your starting point
Long actions run as jobs (ADR 0003): a row in `jobs`, claimed by the worker with
`SELECT ... FOR UPDATE SKIP LOCKED` (`app/jobs/queue.py`), run by a handler registered in
`app/jobs/handlers.py` (`@register("estimate")`). Phase 0 registers none. Handlers get a
`JobContext` (`session`, `job`, `gateway`) and return a dict matching the contract's result for that
kind (`EstimateResult`, `Preview`, `TermReport`, `Export`) or raise `JobFailed(code, message)` with a
contract `ErrorCode`.

`searchtrail/workflow.py` (`CullWorkflow`) already does prepare, preview, term report and the guarded
export, through the `PurviewGateway` interface, but it blocks (`wait_for_operation`) and keeps state in
JSON files and `audit.jsonl`. The CLI must keep working.

## Run locally
```bash
# Backend (Python 3.12)
cd backend && python3.12 -m venv .venv && . .venv/bin/activate && pip install -e ".[dev]"
pytest && ruff check .
# Postgres-only tests: SEARCHTRAIL_TEST_DATABASE_URL=postgresql+psycopg://user:pw@localhost:5432/test pytest

# Whole stack, dry run on (no tenant): API on :8000, worker, Postgres
docker compose -f deploy/docker-compose.yml up --build
curl localhost:8000/api/v1/health

# Frontend: mocks on (MSW serves the contract's examples)
cd frontend && npm ci && npm run dev        # http://localhost:5173
npm run dev:api                             # mocks off, /api proxied to :8000
npm run lint && npm run typecheck && npm test

# After any contract change (contract PRs only)
scripts/codegen.sh                          # regenerates Pydantic models, TS types, mock examples
npx @stoplight/spectral-cli@6.15.0 lint contracts/openapi.yaml --fail-severity=warn
```

## Tasks (in order)
1. Split the workflow into resumable steps: start the Purview operation, save its URL with
   `ctx.heartbeat(checkpoint={...})`, poll with `gateway.get_operation()` (backing off, updating
   `progress`), then finish. A resumed job reads `job.checkpoint` and never starts a second operation.
2. Move the export checks (`export_not_previewed`, `export_counts_changed`, same sources) into one
   reusable function that both the export job and B1's `/exports/check` call. A blocked export must
   make no Purview write calls (existing test: only GETs).
3. Handlers for all six kinds: `estimate`, `preview` (estimate + item report, parse with `report.py`,
   store items in `preview_items` via B1's repositories, store files in `app/storage`),
   `term_report`, `export`, `download` (stream with `gateway.download_file` to storage, never
   buffering whole files), `review_set` (`gateway.add_to_review_set`).
4. Storage: local volume (`SEARCHTRAIL_STORAGE_DIR`) behind a small interface that WS-G can swap for
   blob storage later.
5. Map Graph failures to error codes: 429 -> `graph_throttled` (retry later with `run_after`),
   403 -> `purview_permission_missing`, failed operations -> `purview_operation_failed`.
6. Keep the CLI working on the same code (`searchtrail --dry-run preview/export examples/matter.json`).

## Done when
- A test kills a worker mid-operation (stale heartbeat) and a second worker finishes the job using the
  stored operation URL, with exactly one Purview start call.
- All six job kinds pass in dry run, including blocked exports and count drift.
- The existing workflow and CLI tests still pass.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[B2] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `B2` in `.github/ownership.yml`.
- Stay in your paths. Touching another workstream's paths needs a note in the PR and that owner's review.
- One branch and one git worktree for this workstream; small PRs into `main`; CI green (lint, type
  check, unit tests, contract drift, compose smoke test).
- Everything works with `SEARCHTRAIL_DRY_RUN=1`. A new Purview call gets a dry-run answer in
  `DryRunTransport` in the same PR.
- No secrets in the repo, ever. Only `.env.example` files with empty values.
- Errors use the contract's `Error` body (`code`, plain-English `message`, `details`). Raise
  `app.api.errors.ApiError` in the backend.
- Done means: tests added, docs updated, and for UI, a screenshot in the PR next to the matching file
  in `docs/design/`.
- Merge order when PRs collide: contract, backend core and DB, gateway, frontend components,
  screens, end-to-end tests.

## Where things are
| Path | What |
|---|---|
| `backend/searchtrail/` | Core: `query.py` (criteria to KQL and methodology), `workflow.py` (prepare, preview, terms, guarded export), `report.py`, `labels.py`, `audit.py` (hash chain), `gateway*.py`, `graph.py`, `dryrun.py`, `cli.py` |
| `backend/app/` | FastAPI: `main.py`, `api/`, `schemas/`, `db/` (models, Alembic), `jobs/`, `auth/`, `microsoft/`, `storage/`, `settings.py` |
| `frontend/src/` | `app/` (shell, routes), `components/`, `screens/<name>/`, `api/` (client, hooks), `mocks/`, `styles/` (tokens) |
| `docs/design/` | The seven screens: visual and behavioural spec (read its README) |
| `docs/adr/` | Why the stack is what it is, and where Phase 0 departed from the plan |
