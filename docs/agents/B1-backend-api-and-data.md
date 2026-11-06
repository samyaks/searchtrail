# WS-B1 · Backend API and data

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `backend/app/api/`, `backend/app/schemas/` (hand-written helpers only; `contract.py` is generated), `backend/app/db/` (models, migrations, repositories).
**Do not edit:** `backend/app/jobs/` (B2), `backend/app/auth/` and `backend/app/microsoft/` (C), `backend/searchtrail/` (B2 owns `workflow.py`, C owns `graph.py`, `dryrun.py`, `gateway_*.py`), `frontend/`, `deploy/`, except through a PR note to the owner.

## Your starting point
The API serves every endpoint in `contracts/openapi.yaml` except auth (`/auth/*`), `/me`, `/setup/check`,
`/labels` and `/directory/users` (WS-C) and the job handlers behind the `202` endpoints (WS-B2). Today
only `/api/v1/health` exists (`app/api/health.py`), the database has every table from the first
migration (`app/db/models.py`, `0001`), and `app/jobs/queue.py` has `enqueue()`.

Key facts:
- Routes go in `app/api/<resource>.py`, are included in `app/api/__init__.py`, and use the generated
  models from `app.schemas.contract` as `response_model`, with the contract's `operationId`
  (`operation_id=` on the decorator). `tests/test_contract.py` fails if a route isn't in the contract.
- `/kql/preview` must use `searchtrail.query` (`CullCriteria.from_dict`, `build_kql`, `validate`,
  `describe`). Never build KQL anywhere else. `CriteriaError` maps to `422 criteria_invalid`.
- The log uses the existing chain format from `searchtrail/audit.py` (`canonical()`, SHA-256 over the
  record without `hash`, genesis `0` x 64), stored in `audit_entries`, one chain per matter. Appends
  must be serialised per matter (lock the matter row).
- `202` endpoints create a query version when needed, then `queue.enqueue(...)` and return the job.

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
1. Repository helpers in `app/db/` (sessions per request via `get_session`), a `current_user`
   dependency stub that WS-C replaces (dry run: a fixed sample user).
2. Matters: `GET/POST /matters`, `GET/PATCH /matters/{id}` with stage and latest counts.
3. Custodians and sites: `PUT/DELETE /matters/{id}/custodians/{userId}`, `POST/DELETE .../sites`.
   The hold endpoint stores the request and calls the gateway's `apply_hold`/`remove_hold`.
4. Drafts and versions: `GET/PUT /matters/{id}/draft` (save any schema-valid criteria; only
   estimating rejects `criteria_invalid`); `POST /kql/preview`; version creation on
   estimate (criteria, KQL, `kql_sha256`, methodology, `sources_fingerprint`), `GET .../versions`,
   `GET .../versions/compare` (plain-English differences from the methodology lines, count delta).
5. The `202` endpoints (`estimates`, `previews`, `term-reports`, `exports`, `download`,
   `review-set`): validate, create the version, enqueue, return the job (`409 conflict` with
   `details.job_id` if one of that kind is already queued or running); `GET /jobs/{id}` and
   `GET /matters/{id}/jobs?active=true&kind=`.
6. Previews and term reports: `GET .../previews/latest`, items paging and filters, `items.csv`
   (same columns as the CLI's `preview.csv`), `GET .../term-reports/latest`.
7. Exports: `GET .../exports`, `GET /exports/{id}`, `POST .../exports/check` using B2's reusable
   check function; `confirmation_mismatch` when the typed matter number differs.
8. Log: `GET .../log` (newest first, paged), `POST .../log/verify`; every state change writes a log
   entry with the action names in the contract's `LogAction`, and both `actor` (display name) and
   `actor_email` (UPN) so people are identified unambiguously.
9. Contract tests per endpoint (status codes, bodies validate against `app.schemas.contract`), and one
   test that runs the whole flow through the API in dry run (create, custodians, draft, estimate,
   preview, terms, check, export, log verify), driving jobs with `app.jobs.worker.run_one`.

## Done when
- Every endpoint you own matches the contract (contract tests pass, including error codes).
- The whole flow runs through the API in dry-run mode, in a test.
- `alembic check` is clean; every schema change has a migration.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
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
