# WS-E · Screens: Matters, Define, Scope

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `frontend/src/screens/matters/`, `frontend/src/screens/define/`, `frontend/src/screens/scope/`.
**Do not edit:** `frontend/src/components/`, `src/app/`, `src/api/`, `src/mocks/` (D: ask for components, hooks and mock handlers), other screens (F), `backend/`, except through a PR note to the owner.

## Your starting point
Build each screen to match `docs/design/Main.dc.html`, `Define.dc.html` and `Scope.dc.html` (read
`docs/design/README.md`: layout and styles are inline, sample data and behaviour are in the
`<script type="text/x-dc">` block; the files still say "culltool", the product is SearchTrail).

The Matters screen already renders the list through the generated client; finish it (search box,
counts on filter chips, New matter). Use WS-D's components and hooks; until they land, build
against MSW mocks (`npm run dev`).

Important: Scope never builds KQL in the browser. It calls `POST /kql/preview` (debounced, about
300 ms) as the user edits and shows the returned KQL, methodology lines and warnings. Criteria fields
match the contract's `Criteria` schema exactly.

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
npm run --prefix frontend lint:contract     # Spectral, version locked
```

## Tasks (in order)
1. Matters: stage filter chips with counts, search, New matter (create form posting `POST /matters`),
   rows linking to the matter.
2. Define: details form (`PATCH /matters/{id}`), people search (`GET /directory/users?q=`), custodian
   cards with mailbox/OneDrive toggles and sites (`PUT`/`DELETE .../custodians/{userId}`), hold
   switches (`PUT .../hold`, showing pending, on, releasing), sites without a custodian, and the
   "sources changed, not previewed" header state.
3. Scope: terms (any/all), exclusions, dates and document date property, item types, file types,
   domains, labels (only/any/exclude per label, from `GET /labels`), live KQL and methodology from
   `/kql/preview`, saving the draft (`PUT .../draft`), Estimate (`POST .../estimates` + `useJob`), and
   the "query changed, estimate again" state.
4. Map `criteria_invalid` and the other error codes to the design's inline messages.

## Done when
- Each screen works against the mocks and against the dry-run backend (`npm run dev:api`).
- A Playwright test per main action (with WS-G's e2e setup), and Vitest tests for logic.
- PR screenshots next to the matching design files.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[E] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `E` in `.github/ownership.yml`.
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
