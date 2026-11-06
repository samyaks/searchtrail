# WS-G · Quality, packaging and docs

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `deploy/`, `.github/workflows/`, `frontend/tests/e2e/`, `docs/install/`.
**Do not edit:** application code in `backend/` and `frontend/src/` (raise issues or PRs to the owners), except through a PR note to the owner.

## Your starting point
Phase 0 left: `deploy/Dockerfile.backend` (one image for API, worker, migrations; optional
`extra_ca` build secret for TLS-inspecting proxies), `deploy/docker-compose.yml` (db, migrate, api,
worker with health checks, dry run on), `deploy/.env.example`, and `.github/workflows/ci.yml`
(backend, frontend, contract drift, compose smoke test). There is no web image and no e2e suite yet
(ADR 0010). Baseline API security headers are in `backend/app/main.py`.

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
1. A `web` image: build the frontend, serve it with a reverse proxy (for example Caddy or nginx) that
   also proxies `/api` to the API, so browser and API share an origin; add it to compose.
2. Security: CSP for the web app (self-hosted fonts make a strict one possible), HSTS behind TLS,
   cookie flags checked in tests, TLS termination options in the install guide.
3. Playwright e2e in `frontend/tests/e2e/`, running the full flow against the dry-run compose stack
   in CI (create matter, custodians, scope, estimate, preview, terms, export, download, log verify).
   Pass `--trace off` by default.
4. Install guide (`docs/install/`): a VM with Docker Compose in Azure or AWS, sizing (export storage),
   backups, upgrades (migrations), and an admin guide for the Entra app registration and permissions
   (from WS-C).
5. CI hygiene: cache, required checks list for branch protection, image builds on `main`.

## Done when
- A fresh VM goes from nothing to a working dry-run install by following the guide (record it).
- The e2e suite runs green in CI against the dry-run stack.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[G] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `G` in `.github/ownership.yml`.
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
