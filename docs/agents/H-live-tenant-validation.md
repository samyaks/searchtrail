# WS-H · Live tenant validation (an agent plus a human with tenant access)

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `backend/tests/fixtures/live/`, `docs/validation/`.
**Do not edit:** everything else; send fixes as PRs to the owning workstream (report columns and dry-run data: WS-C; workflow: WS-B2), except through a PR note to the owner.

## Your starting point
Nothing in SearchTrail has run against a live Microsoft 365 tenant. A human with a Microsoft 365 E5
trial (seeded with sample mail, Teams chats and SharePoint/OneDrive files) runs the tools; the agent
records results and turns them into fixtures and fixes. Real credentials stay with the human, never in
the repo; scrub tenant IDs, names and email addresses from every fixture.

Start now with the CLI (it needs no web app). From the repo root: `pip install -e backend`, copy
`.env.example` to `.env` and fill it in (README "Connect to a real tenant"), then `searchtrail labels`, `searchtrail kql examples/matter.json`,
`searchtrail preview ...`, `terms`, `export --confirm --wait`, `verify-log`. Later, the V1 build.

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
1. Run the CLI flow live; record scrubbed Graph responses (cases, custodians, searches, operations,
   report and export file metadata) and sample report files in `backend/tests/fixtures/live/`.
2. Answer the open questions in docs/V1_PLAN.md section 8: real report column names (update
   `COLUMN_CANDIDATES` via WS-C), Teams kinds (`kind:microsoftteams` vs `kind:im`), date and domain
   KQL behaviour (compare counts with the Purview portal), download headers and the
   MicrosoftPurviewEDiscovery permission, review set calls, query length limits.
3. Feed fixtures into `DryRunTransport` (with WS-C) so dry run matches reality.
4. When the V1 build is ready: sign in, run the full flow live, record results.
5. Write each finding in `docs/validation/` (what was tested, date, result, evidence).

## Done when
- The full flow passes live in the E5 trial tenant.
- Every open question in section 8 has a recorded answer and, where needed, a merged fix.

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[H] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `H` in `.github/ownership.yml`.
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
