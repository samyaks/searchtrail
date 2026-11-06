# WS-C · Microsoft sign-in and Graph

Context: SearchTrail V1 ("Evidence of how you searched"): a web app a legal, investigations or records
team runs inside its own environment to build precise Microsoft Purview eDiscovery searches, preview
them, export them, and keep a tamper-evident record of how the search was done. Read
docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6; skim `docs/adr/`.

**You own:** `backend/app/auth/`, `backend/app/microsoft/`, `backend/searchtrail/graph.py`, `backend/searchtrail/dryrun.py`, `backend/searchtrail/gateway_graph.py`, `backend/searchtrail/gateway_dryrun.py`, `backend/searchtrail/auth.py`, `backend/searchtrail/config.py`.
**Do not edit:** `backend/searchtrail/gateway.py` (shared contract: changes by approved PR only), `backend/app/api/` (B1; you add `api/auth.py`, `api/me.py`, `api/labels.py`, `api/setup.py`, `api/directory.py` with a PR note), `backend/app/db/` (B1), `frontend/`, except through a PR note to the owner.

## Your starting point
Sign-in is a backend-for-frontend (ADR 0004): authorization code flow with PKCE (MSAL confidential
client), tokens kept server-side in `token_cache` (encrypted), an HTTP-only `st_session` cookie for the
browser. Delegated, so Purview's audit log names the real person.

The `PurviewGateway` (ADR 0011) has two implementations. Live (`GraphPurviewGateway`) still raises
`GatewayNotImplemented` for `search_users`, `apply_hold`, `remove_hold`, `add_to_review_set`; the
dry-run versions in `gateway_dryrun.py` show the intended Graph calls. `download_file` exists live but is
unverified. `app/microsoft/get_gateway()` only supports dry run today.

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
Task 1 comes first because the shell, Define and Scope need it against the dry-run backend for M1.
Tasks 2 to 9 come after M1 (see `docs/PHASE1_PLAN.md`): live sign-in can't be tested without a tenant.

1. **Dry run first:** `/me`, `/labels` and `/directory/users`, backed by the dry-run gateway and a
   fixed sample user (Dana Whitfield) with no sign-in. Add `api/me.py`, `api/labels.py` and
   `api/directory.py` to the router layout WS-B1's first PR sets up in `app/api/__init__.py`, with a
   PR note.
2. Settings for the Entra app (tenant, client ID, secret or certificate, redirect URI, session secret,
   token encryption key) in `app/settings.py` (B1's file) with empty entries in `deploy/.env.example`
   (G's file); say so in the PR.
3. `/auth/login`, `/auth/callback`, `/auth/logout`: PKCE and state, user upsert into `users`, a
   `sessions` row, the cookie (HttpOnly, Secure, SameSite=Lax), `401 session_expired` handling.
4. Encrypted per-user MSAL token cache (`token_cache`), refresh for long jobs; a `current_user`
   dependency that replaces B1's stub. Dry run keeps the fixed sample user.
5. A per-user live gateway: `get_gateway(settings, user)` building `GraphPurviewGateway` with that
   user's Graph and MicrosoftPurviewEDiscovery tokens.
6. Implement live: `search_users` (`/users?$search`, ConsistencyLevel), `apply_hold`/`remove_hold`,
   `add_to_review_set` (create review set if missing, `addToReviewSet` from the search), and confirm
   streaming `download_file`, then restrict downloads to the real download hosts WS-H records
   (operation URLs are already restricted to the Graph host). Fix the known gap in
   `ensure_user_source`: it reuses an existing user source even when its `includedSources` differ,
   so turning a custodian's mailbox or OneDrive off must replace the source (tests in both gateways). Unit-test each against recorded responses (no network in tests).
7. `/setup/check` (licence, Purview role, download consent, labels permission), and live `/me`,
   `/labels` and `/directory/users`.
8. Cloud endpoints configurable (Graph and login hosts) so GCC High can be added later.
9. Admin notes for the Entra app registration and permissions, handed to WS-G for the install guide.

## Done when
- Sign-in works against a test tenant (with WS-H).
- Every gateway method has a dry-run version and a unit-tested live implementation; no
  `GatewayNotImplemented` left.
- Tokens never reach the browser (test the responses and cookies).

## Contracts (shared; don't change them inside a feature PR)
- `contracts/openapi.yaml`: the API. Generated from it (never edit): `backend/app/schemas/contract.py`,
  `frontend/src/api/schema.d.ts`, `frontend/src/mocks/examples.json`.
- `backend/searchtrail/gateway.py`: the `PurviewGateway` interface.
- To change either: a separate small PR with the change, regenerated code (`scripts/codegen.sh`),
  updated implementations and a one-line reason. The integrator approves it. Then rebase.

## Ground rules
- Read `CONTRIBUTING.md`. Title every PR `[C] ...` (contract PRs: `[contract] ...`); the
  ownership check in CI uses it. Your paths are listed under `C` in `.github/ownership.yml`.
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
