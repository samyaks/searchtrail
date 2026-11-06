# WS-F · Screens: Preview, Terms, Export, Log

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `frontend/src/screens/preview/`, `frontend/src/screens/terms/`, `frontend/src/screens/export/`, `frontend/src/screens/log/`.
**Do not edit:** `frontend/src/components/`, `src/app/`, `src/api/`, `src/mocks/` (D), other screens (E), `backend/`, except through a PR note to the owner.

## Your starting point
Build each screen to match `docs/design/Preview.dc.html`, `Terms.dc.html`, `Export.dc.html` and
`Log.dc.html` (read `docs/design/README.md`). Out of scope for V1: the Terms screen's "Try without"
buttons and the unique-hits column.

Export adds two hand-off options that aren't in the design: "Download the package"
(`POST /exports/{id}/download`) and "Send to a Purview review set (for Relativity)"
(`POST /exports/{id}/review-set`). Both are jobs; show progress with WS-D's `useJob`.

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
1. Preview: start a preview (`POST .../previews` + `useJob`), count tiles, the three breakdowns
   (clicking a bar filters the item table), month chart, item table with paging
   (`GET /previews/{id}/items`), download CSV (`items.csv`), stale banner when the draft changed.
2. Terms: start a term report, hits per term with bars and change from the previous version.
3. Export: run checks (`POST .../exports/check`) and show each; options; typed matter-number
   confirmation; start (`POST .../exports`); blocked states for `export_not_previewed`,
   `export_counts_changed` (with an explicit, logged accept) and `confirmation_mismatch`; export
   history with status; the two hand-off options; the methodology card.
4. Log: versions with counts, entries (newest first, paged) with hashes, verify
   (`POST .../log/verify`) with the result, and version comparison (`.../versions/compare`).

## Done when
- Each screen works against the mocks and against the dry-run backend, including every blocked
  export state.
- A Playwright test per main action, and Vitest tests for logic.
- PR screenshots next to the matching design files.

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
