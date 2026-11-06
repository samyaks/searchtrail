# WS-D · Frontend foundation and components

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `frontend/src/app/`, `frontend/src/components/`, `frontend/src/api/` (except generated `schema.d.ts`), `frontend/src/mocks/` (except generated `examples.json`), `frontend/src/styles/`.
**Do not edit:** `frontend/src/screens/` (E and F), `frontend/tests/e2e/` (G), the generated files, `backend/`, except through a PR note to the owner.

## Your starting point
The scaffold has routes for the seven screens (`src/app/routes.tsx`, tabs in `tabs.ts`), a basic
shell and matter layout, design tokens (`src/styles/tokens.css`, V1_PLAN 5.6), a typed client
(`src/api/client.ts`, `openapi-fetch` over the generated types) with TanStack Query hooks
(`src/api/queries.ts`), and MSW handlers that serve the contract's examples
(`src/mocks/handlers.ts`, `example(operationId, status)`). Only the Matters screen shows data.

The design files in `docs/design/` hold exact colours, spacing and type inline; read
`docs/design/README.md`. Use tokens, never raw hex.

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
1. **First, within a day or two** (E and F are waiting): buttons, chips, segmented controls,
   switches, cards and data tables, using the tokens. Publish them from `src/components/index.ts`.
2. The shell to match the design: side navigation (tenant, connection state, links, user), the
   matter header (number, name, sub line, version and preview chips) and the tabs.
3. Count tiles, bar breakdowns (clickable filters), the month chart, the pleading-paper methodology
   card (numbered lines, Courier Prime), banners, empty and error states.
4. `useJob(jobId)`: polls `GET /jobs/{id}` every 3 to 10 seconds until `succeeded`/`failed`, exposing
   progress and the typed result; invalidates related queries when done. On load, screens resume
   jobs already running via `GET /matters/{id}/jobs?active=true` (survives reloads and other tabs).
5. Error handling for every code in the contract's `ErrorCode` (section 5.3): a shared mapping from
   code to UI treatment; `session_expired` redirects to `/api/v1/auth/login?return_to=...`.
6. MSW handlers for every endpoint in the contract, with enough state (draft edits, job progress)
   for E and F to build against. Add examples to the contract (contract PR) rather than inventing data.
7. A component gallery route (`/_gallery`, dev only) showing every component and state.

## Done when
- The gallery shows every component; axe checks pass (keyboard and screen reader) in Vitest.
- Every endpoint has an MSW handler.
- Screenshots of the shell next to `docs/design/Main.dc.html`.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[D] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `D` in `.github/ownership.yml`.
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
