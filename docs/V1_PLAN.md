# SearchTrail V1 build plan

A plan for building SearchTrail V1 (web frontend plus backend) with several agents working at the
same time. One foundation phase comes first and must finish before the parallel work starts,
because it fixes the contracts everyone builds against.

- **Product:** SearchTrail ("Evidence of how you searched"), formerly `culltool`.
- **Starting point:** the Python package in this repo (`culltool/`). It has the Purview
  eDiscovery calls, KQL builder, report parser, hash-chained log, and an offline dry-run mode,
  with 49 passing tests. It is a command-line tool and has not run against a live tenant.
- **Design:** the seven screens in `docs/design/` (source of the design canvas): Matters, Define,
  Scope, Preview, Terms, Export, Log.

---

## 1. What V1 is

A web app that a legal, investigations or records team runs **inside its own environment**. A
signed-in user can:

1. Create a matter and choose custodians and sites (Define).
2. Set search criteria and see the KQL and plain-English methodology update as they type (Scope).
3. Estimate counts, then preview item-level metadata without moving any content (Preview).
4. See hits per search term (Terms).
5. Export the previewed set, guarded so it must match the preview, then either let a review tool
   pick it up or download it (Export).
6. See and verify the tamper-evident log of everything done on the matter (Log).

### Definition of done for V1
- Every screen in `docs/design/` works end to end against the backend in **dry-run mode**
  (no tenant needed), covered by automated end-to-end tests.
- The same build works against a **live Microsoft 365 E5 trial tenant** for the full flow:
  create matter, estimate, preview, term counts, export, download, verify log.
- It installs inside a customer environment with one documented procedure (Docker Compose on a VM).
- Sign-in is delegated (users act as themselves), so Purview's audit log names the real person.

### Scope

| In V1 | Later |
|---|---|
| Sign in with Microsoft (Entra ID), delegated permissions | Hosted multi-customer SaaS, FedRAMP or GovRAMP |
| Matters list, create and edit matter | Matter team and roles inside SearchTrail (use Purview roles in V1) |
| Custodians from directory search; mailbox and OneDrive toggles; sites | GCC High and DoD endpoints (design for it; test in pilots) |
| Legal holds on and off per custodian | Unique hits and "Try without" on the Terms screen |
| Scope: all filters in `query.py`, live KQL and methodology | Excel export of the term report |
| Estimate, preview report, item table, `preview.csv` | AI-assisted query drafting |
| Per-term hit counts | Notifications (email or Teams) when exports finish |
| Guarded export, export status, export history | Pushing data through review tool APIs |
| **Export download** (to the customer's storage) | |
| **Send to a Purview review set** (for Relativity's Purview Sync) | |
| Hash-chained log, verify, query version history and comparison | |

---

## 2. Architecture

```
 Browser (React app)
     │  HTTPS, session cookie (no tokens in the browser)
     ▼
 API service (FastAPI) ───────────────┐
     │ reads/writes                   │ enqueues jobs
     ▼                                ▼
 PostgreSQL  ◄────────────── Worker (same codebase, separate process)
 (matters, versions, jobs,            │ Microsoft Graph, as the signed-in user
  runs, items, log)                   ▼
     ▲                         Microsoft Purview eDiscovery
     │                                │ export packages
 File storage (volume or blob) ◄──────┘ (downloads, report files)
```

### Technology decisions (record each as an ADR in `docs/adr/` during Phase 0)
| Area | Choice | Why |
|---|---|---|
| Backend | Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic | Reuses the existing Python core directly |
| Database | PostgreSQL 16 | One dependency the customer already knows how to run |
| Background jobs | A `jobs` table in Postgres, polled by the worker with `SELECT … FOR UPDATE SKIP LOCKED` | Estimates take minutes and exports hours; no Redis to install; jobs survive restarts |
| Auth | Backend-for-frontend: the API runs the Entra authorization code flow (MSAL confidential client), keeps tokens server-side (encrypted), and gives the browser an HTTP-only session cookie | Tokens never reach the browser; delegated access keeps real names in Purview's audit log |
| Frontend | React 18, TypeScript, Vite, React Router, TanStack Query | Mainstream, easy for agents to work in |
| API types | `contracts/openapi.yaml` is the source of truth; `openapi-typescript` for the frontend, Pydantic models checked against it in CI | Lets frontend and backend work in parallel |
| Frontend mocks | MSW (Mock Service Worker) handlers built from the OpenAPI examples | Frontend agents don't wait for the backend |
| Tests | pytest, Vitest, Playwright | |
| Packaging | Docker images for `api`, `worker`, `web`; `deploy/docker-compose.yml` with Postgres | Single install procedure inside the customer environment |
| Offline mode | `SEARCHTRAIL_DRY_RUN=1` uses the existing `DryRunTransport` | Whole app runs and is tested with no tenant |

### Repository layout (created in Phase 0)
```
searchtrail/
  backend/
    searchtrail/          # existing core, renamed from culltool/ (query, ediscovery, report,
                          #   labels, audit, graph, dryrun, matter, workflow, cli)
    app/
      main.py             # FastAPI app factory, middleware, security headers
      api/                # routers, one module per resource
      schemas/            # Pydantic request/response models (match the contract)
      db/                 # SQLAlchemy models, Alembic migrations, repositories
      jobs/               # job table access, worker loop, task handlers
      auth/               # Entra sign-in, sessions, token cache
      microsoft/          # PurviewGateway: real (Graph) and dry-run implementations
      storage/            # file storage (local volume first, blob later)
    tests/
  frontend/
    src/
      app/                # routing, shell, auth guard, providers
      components/         # design-system components
      screens/            # one folder per screen
      api/                # generated types, client, query hooks
      mocks/              # MSW handlers and fixtures
    tests/                # Vitest and Playwright
  contracts/openapi.yaml
  deploy/                 # Dockerfiles, docker-compose.yml, .env.example
  docs/                   # this plan, ADRs, install guide, design source
  .github/workflows/      # CI
```

---

## 3. How the agents work together

1. **Contract first.** Nothing in the parallel phase changes `contracts/openapi.yaml` or the
   `PurviewGateway` interface without a small PR approved by the integrator (the person merging,
   or a lead agent). Generated types are rebuilt in the same PR.
2. **Own your folders.** Each workstream owns the paths listed in its section. Touching another
   workstream's paths needs a note in the PR and the owner's review.
3. **One branch and one git worktree per workstream.** Small PRs into `main`, each green in CI
   (lint, type check, unit tests, contract check).
4. **Dry-run is the shared test bed.** Every backend feature must work with
   `SEARCHTRAIL_DRY_RUN=1`, and extend `DryRunTransport` when it adds a new Purview call.
5. **No secrets in the repo.** Only `.env.example`. Real tenant credentials stay with the human
   running live tests.
6. **Done means:** tests added, docs updated, and for UI work, a screenshot in the PR compared
   with the matching file in `docs/design/`.
7. **Merge order** when PRs collide: contract → backend core and DB → gateway → frontend
   components → screens → end-to-end tests.

---

## 4. Phase 0: foundation (one agent, blocks everything else)

**Goal:** a repo where six agents can start on day one without stepping on each other.
**Effort:** about 2–3 days of agent work, plus a human review.

| # | Task | Done when |
|---|---|---|
| 0.1 | Put the code in a GitHub repo (`searchtrail`) with branch protection on `main` | Agents can clone and open PRs |
| 0.2 | Rename `culltool` to `searchtrail` (package, CLI command, README, examples); move into `backend/` | 49 existing tests pass; `searchtrail --dry-run preview examples/matter.json` works |
| 0.3 | Write `contracts/openapi.yaml` covering every endpoint in section 5.1, with examples | Spectral lint passes; examples cover each screen's data |
| 0.4 | Define `PurviewGateway` (section 5.4) and wrap the existing `ediscovery.py` and `DryRunTransport` behind it | Existing workflow tests pass through the interface |
| 0.5 | Scaffold FastAPI (`/health` only), Alembic with an empty first migration, the worker entrypoint | `docker compose up` gives a healthy API, worker and Postgres |
| 0.6 | Scaffold the React app: routing to seven empty screens, design tokens (section 5.6), generated API types, MSW enabled in dev | `npm run dev` shows the shell with mocked data on one screen |
| 0.7 | CI: backend lint and tests, frontend lint, type check and tests, contract drift check | CI green on `main` |
| 0.8 | ADRs for each decision in section 2; one-page agent brief per workstream in `docs/agents/` | Briefs merged |

---

## 5. Shared contracts (fixed at the end of Phase 0)

### 5.1 API endpoints (all under `/api/v1`)

| Method and path | Purpose | Screen |
|---|---|---|
| `GET /auth/login`, `GET /auth/callback`, `POST /auth/logout` | Entra sign-in and sign-out | All |
| `GET /me` | Signed-in user, tenant, Purview roles found | Shell |
| `GET /setup/check` | Can we reach Purview, which licenses and roles, which cloud | Shell, first run |
| `GET /labels` | Sensitivity labels (with sublabels) | Scope |
| `GET /directory/users?q=` | People search for custodians | Define |
| `GET /matters`, `POST /matters` | List (with stage and latest counts) and create | Matters, Define |
| `GET /matters/{id}`, `PATCH /matters/{id}` | Matter details | Define, header |
| `PUT /matters/{id}/custodians/{userId}`, `DELETE …` | Add or update a custodian (mailbox, OneDrive) or remove | Define |
| `PUT /matters/{id}/custodians/{userId}/hold` | Place or release a hold | Define |
| `POST /matters/{id}/sites`, `DELETE /matters/{id}/sites/{siteId}` | Sites without a custodian | Define |
| `GET /matters/{id}/draft`, `PUT /matters/{id}/draft` | The criteria being edited | Scope |
| `POST /kql/preview` | Criteria in, KQL plus methodology plus warnings out (no Purview call; instant) | Scope |
| `POST /matters/{id}/estimates` | Start an estimate of the current draft (creates a query version) | Scope |
| `POST /matters/{id}/previews`; `GET /matters/{id}/previews/latest` | Start or read a preview (counts and breakdowns) | Preview |
| `GET /previews/{pid}/items?location=&type=&label=&page=` | Item table with filters | Preview |
| `GET /previews/{pid}/items.csv` | Full item list | Preview |
| `POST /matters/{id}/term-reports`; `GET …/latest` | Hits per term | Terms |
| `POST /matters/{id}/exports/check` | Run the export checks without exporting | Export |
| `POST /matters/{id}/exports` | Start a guarded export (body includes options and the typed matter ID) | Export |
| `GET /matters/{id}/exports`, `GET /exports/{eid}` | Export history and status | Export |
| `POST /exports/{eid}/download` | Download the package to SearchTrail's storage | Export |
| `POST /exports/{eid}/review-set` | Add the culled search to a Purview review set (for Relativity's Purview Sync) | Export |
| `GET /matters/{id}/versions`, `GET /matters/{id}/versions/compare?from=&to=` | Query versions and differences | Log |
| `GET /matters/{id}/log`, `POST /matters/{id}/log/verify` | Log entries and hash-chain check | Log |
| `GET /jobs/{jobId}` | Job status and progress | All long actions |

### 5.2 Jobs
Every long action returns `202` with a job:
```json
{ "id": "job_…", "kind": "estimate | preview | term_report | export | download | review_set",
  "status": "queued | running | succeeded | failed", "progress": 0.42,
  "result": { }, "error": { "code": "…", "message": "…" } }
```
The frontend polls `GET /jobs/{id}` (TanStack Query, every 3–10 seconds). Jobs resume after a
worker restart by re-polling the Purview operation URL stored on the job.

### 5.3 Errors
`{ "code": "…", "message": "plain-English fix", "details": { } }`. Codes the UI must handle:
`criteria_invalid`, `export_not_previewed`, `export_counts_changed`, `confirmation_mismatch`,
`purview_permission_missing`, `license_missing`, `graph_throttled`, `purview_operation_failed`,
`session_expired`.

### 5.4 `PurviewGateway` (backend interface between workstreams B and C)
```python
class PurviewGateway(Protocol):
    def ensure_case(...); def ensure_custodian(...); def ensure_user_source(...)
    def add_site_source(...); def create_search(...); def update_query(...)
    def add_additional_site(...)
    def start_estimate(...) -> str; def start_report(...) -> str; def start_export(...) -> str
    def get_operation(url) -> dict
    def download_file(url, dest_stream)                # MicrosoftPurviewEDiscovery token
    def add_to_review_set(case_id, search_id, review_set_name) -> str
    def apply_hold(...); def remove_hold(...)
    def list_labels() -> list[dict]; def search_users(q) -> list[dict]
```
Two implementations: `GraphPurviewGateway` (live) and `DryRunPurviewGateway` (offline).

### 5.5 Data model (first migration)
`users`, `sessions`, `token_cache` (encrypted) · `matters` · `custodians` · `sites` ·
`criteria_drafts` · `query_versions` (criteria, KQL, methodology, sources fingerprint, Purview
search ID) · `runs` (estimate, preview, term report; counts; files) · `preview_items` ·
`exports` (options, status, files, expiry) · `holds` · `jobs` · `audit_entries` (hash chain,
same format as `audit.py`).

### 5.6 Design tokens (from `docs/design/`)
Paper `#F5F6F3`, sheet `#FFFFFF`, ink `#16181D`, muted `#5A606B`, rule `#DADCD5`, margin red
`#B42318`, highlighter `#FFE14D`, OK green `#1E7A46`. Fonts: Libre Caslon Text (headings),
Public Sans (body), Courier Prime (queries, terms, IDs, methodology). Light theme only.

---

## 6. Parallel workstreams

Start all seven when Phase 0 is merged. Each has an agent brief in `docs/agents/` (task 0.8).

### WS-B1 · Backend API and data
- **Owns:** `backend/app/api/`, `backend/app/schemas/`, `backend/app/db/`
- **Builds:** all endpoints in 5.1 except auth and Microsoft-specific ones; Postgres models and
  migrations; matters, custodians, sites, drafts and versions; `/kql/preview` using `query.py`;
  preview item paging and CSV; log storage in Postgres with the existing hash-chain format;
  log verify; version comparison.
- **Done when:** every endpoint matches the contract (contract tests), and the whole flow runs
  through the API in dry-run mode.

### WS-B2 · Jobs and Purview workflow
- **Owns:** `backend/app/jobs/`, `backend/searchtrail/workflow.py`
- **Builds:** the jobs table and worker loop; refactor the blocking workflow into resumable
  steps (start operation, store its URL, poll, finish); tasks for estimate, preview report, term
  report, guarded export, download and review set; export checks (`export_not_previewed`,
  `export_counts_changed`) moved into a reusable function that `/exports/check` also uses.
- **Done when:** jobs survive a worker restart mid-operation (test it), and all six job kinds
  pass in dry-run.

### WS-C · Microsoft sign-in and Graph
- **Owns:** `backend/app/auth/`, `backend/app/microsoft/`, `backend/searchtrail/graph.py`,
  `backend/searchtrail/dryrun.py`
- **Builds:** Entra authorization code flow with PKCE (MSAL), sessions, encrypted token cache
  per user; `GraphPurviewGateway` including the new calls (directory search, holds, add to
  review set, streaming export download); cloud endpoints configurable for GCC High later;
  `/me` and `/setup/check`; matching dry-run behavior for every new call.
- **First deliverable:** the dry-run `/me`, `/labels` and `/directory/users`, which the shell,
  Define and Scope need for M1. Live sign-in and the live Graph calls follow.
- **Done when:** sign-in works against a test tenant; every gateway method has a dry-run and a
  unit-tested live implementation.

### WS-D · Frontend foundation and components
- **Owns:** `frontend/src/app/`, `frontend/src/components/`, `frontend/src/api/`, `frontend/src/mocks/`
- **Builds:** the shell (side navigation, matter header, tabs); components from the design:
  buttons, chips, segmented controls, switches, cards, data tables, count tiles, bar
  breakdowns, month chart, the pleading-paper methodology card, banners and error states; job
  polling hook; error handling from 5.3; session-expiry redirect; MSW mocks for every endpoint.
- **First deliverable (within the first day or two):** tokens plus buttons, chips, cards and
  tables, and MSW handlers for every endpoint, so WS-E and WS-F can start on every screen.
- **Done when:** a component gallery page shows every component; keyboard and screen-reader
  checks pass (axe).

### WS-E · Screens: Matters, Define, Scope
- **Owns:** `frontend/src/screens/matters/`, `…/define/`, `…/scope/`
- **Builds:** each screen to match `docs/design/Main.dc.html`, `Define.dc.html` and
  `Scope.dc.html`. Scope calls `/kql/preview` as the user types (debounced) instead of building
  KQL in the browser, and shows the "query changed, estimate again" state.
- **Done when:** each screen works against mocks and against the dry-run backend, with a
  Playwright test per main action.

### WS-F · Screens: Preview, Terms, Export, Log
- **Owns:** `frontend/src/screens/preview/`, `…/terms/`, `…/export/`, `…/log/`
- **Builds:** each screen to match its design file, without the "Try without" and unique-hits
  parts of Terms (later). Export adds two hand-off options: "Download the package" and "Send to
  a Purview review set (for Relativity)". Both show progress through the job hook.
- **Done when:** as for WS-E, including the blocked-export states.

### WS-G · Quality, packaging and docs
- **Owns:** `deploy/`, `.github/workflows/`, `frontend/tests/e2e/`, `docs/install/`
- **Builds:** Docker images; compose file with health checks; security headers (CSP, HSTS,
  cookie flags); the end-to-end suite running the full flow against the dry-run backend in CI;
  install guide (VM with Docker Compose in Azure or AWS); admin guide for the Entra app
  registration and permissions.
- **Done when:** a fresh VM goes from nothing to a working dry-run install by following the guide.

### WS-H · Live tenant validation (an agent plus a human with tenant access)
- **Owns:** `backend/tests/fixtures/live/`, `docs/validation/`
- **Builds:** runs the existing CLI, then the V1 build, against a Microsoft 365 E5 trial seeded
  with sample data; records real (scrubbed) Graph responses and report files as fixtures; fixes
  mismatches (report column names, KQL behavior for Teams and dates, download headers, review
  set calls); feeds the fixtures into `DryRunTransport` so dry-run matches reality.
- **Done when:** the full flow passes live, and the open questions in section 8 are answered.

---

## 7. Timeline

**Phase 1 is run one workstream at a time, by one agent, in the order in
[PHASE1_PLAN.md](PHASE1_PLAN.md), aiming at M1 first.** The chart below is the original parallel
estimate and is kept for reference.

```
Days 1–3      Phase 0 foundation ──────────────►
Week 1–3                 WS-B1 ████████████
                         WS-B2 ████████████
                         WS-C  ████████████
                         WS-D  ██████░░ (kit first, then polish)
                         WS-E     ██████████
                         WS-F     ██████████
                         WS-G  ░░░░██████████
                         WS-H  ████████████████████ (needs tenant; starts now with the CLI)
Week 3–4      Integration: frontend on the real API in dry-run; end-to-end suite green
Week 4–6      Live-tenant runs, fixes, install on a clean VM, pilot-ready build
```
The calendar is set less by coding than by three things: review of PRs, Purview's own speed
(search indexing and exports take minutes to hours), and tenant access for WS-H.

### Milestones
| Milestone | Exit criteria |
|---|---|
| M0 Foundation | Phase 0 table complete; CI green; briefs merged |
| M1 Dry-run complete | Every screen works end to end in dry-run; e2e suite green |
| M2 Live complete | Full flow passes in the E5 trial tenant |
| M3 Pilot-ready | Clean-VM install from the guide; security checklist done; first pilot scheduled |

---

## 8. Risks and open questions

| Risk or question | Owner | How it gets answered |
|---|---|---|
| Real Purview report column names differ from the parser's guesses | WS-H | Recorded fixtures; update `COLUMN_CANDIDATES` |
| KQL behavior for Teams (`kind:microsoftteams` vs `kind:im`), dates and domains | WS-H | Compare counts with the Purview portal |
| Download headers and the MicrosoftPurviewEDiscovery permission | WS-C, WS-H | Live download test |
| Which export options each review tool wants (PST vs MSG, linked files, Teams transcripts) | WS-H with pilot users | Pilot conversations |
| Large exports (tens of GB) and where downloads are stored | WS-B2, WS-G | Streaming to disk; storage sizing in the install guide |
| Delegated tokens expire during multi-hour exports | WS-C, WS-B2 | Refresh tokens in the encrypted cache; resumable jobs |
| Agents diverging from the design | WS-D | Screenshot comparison in every UI PR |
| Contract churn slowing parallel work | Integrator | Contract changes only by small approved PRs |

---

## 9. Agent brief template (`docs/agents/<workstream>.md`)

```
# <Workstream name>
Context: SearchTrail V1. Read docs/V1_PLAN.md sections 1, 3 and 5, and your section in 6.
You own: <paths>. Do not edit: <paths>, except through a PR note to the owner.
Contracts: contracts/openapi.yaml and the PurviewGateway interface. Propose changes in a
separate small PR; don't change them inside your feature PRs.
Run locally: docker compose up (dry-run on), npm run dev (mocks on), pytest, npm test.
Tasks (in order): <numbered list from section 6>
Done when: <criteria from section 6>
PR rules: small PRs, CI green, tests included, screenshots for UI against docs/design/.
```
