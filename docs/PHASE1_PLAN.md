# Phase 1 execution plan: one workstream at a time, to M1

How Phase 1 (the workstreams in [V1_PLAN.md](V1_PLAN.md) section 6) is run. It replaces the parallel
timeline in section 7 for this phase. Everything else in the V1 plan, the [agent briefs](agents/README.md)
and [CONTRIBUTING.md](../CONTRIBUTING.md) still applies.

## Decisions
- **One agent, one workstream at a time, one stream of PRs.** The order below follows every
  dependency between workstreams, so each PR builds on merged work and the integrator reviews one
  PR at a time.
- **Target: M1, dry-run complete.** Every screen works end to end against the dry-run backend, and
  the end-to-end suite passes in CI.
- **No tenant until after M1.** WS-C's live sign-in and Graph calls, WS-G's install guide and WS-H's
  live validation come after M1, on the way to M2 and M3. WS-C's live code is unit-tested against
  recorded responses. WS-H starts when a Microsoft 365 E5 trial and a person to sign in are available.

## Changes to the briefs
These are already applied to the briefs and to V1_PLAN.md section 6.

1. **WS-C builds the dry-run `/me`, `/labels` and `/directory/users` first.** The shell, Define and
   Scope need them against the dry-run backend for M1, and live sign-in can't be tested without a
   tenant.
2. **WS-D ships MSW handlers for every operation in its first PR**, with the first components.
   Phase 0 mocked 5 of the contract's 39 operations, so WS-E and WS-F would otherwise stall after
   the Matters list.
3. **WS-B1 and WS-B2 meet at two seams with fixed signatures** (below). B1's first PR lands the
   repositories B2 writes through. B2's first PR lands the export-check function that B1's
   `/exports/check` calls.
4. **Ownership crossings happen in a set order.** WS-B1's first PR fixes the router layout in
   `app/api/__init__.py` before WS-C adds its routers there. WS-C's Entra settings (in B1's
   `app/settings.py` and G's `deploy/.env.example`) come after M1, with a PR note.

## Order of work
One row is one PR, titled with its workstream (`[B1] ...`). A `[contract]` PR can be inserted
anywhere it's needed (for example, mock examples for WS-D). It merges before the PR that needs it.

### Wave 1: unblock everything else
| # | PR | Builds | Done when |
|---|---|---|---|
| 1 | `[B1] Repositories, current user, matters` | `app/db/repositories/` with the seam functions below; a `current_user` stub (dry run: Dana Whitfield); the router layout in `app/api/__init__.py`; `GET/POST /matters`, `GET/PATCH /matters/{id}` with stage and latest counts | Contract tests pass for the four operations; `npm run dev:api` shows the Matters list from the real API |
| 2 | `[B2] Resumable jobs, storage, export checks` | The start, checkpoint, poll, finish pattern, proven on the `estimate` handler; the storage interface with a local-volume implementation; `check_export` | A test kills a worker mid-estimate and a second worker finishes it with exactly one Purview start call; `check_export` is tested for each check; a blocked export makes only GET calls; CLI tests still pass |
| 3 | `[C] Dry-run /me, /labels, /directory/users` | The three routers, added to B1's router layout with a PR note, backed by the dry-run gateway and user | Contract tests pass; the shell shows tenant and user from the real API |
| 4 | `[D] Component kit and mocks for every operation` | Buttons, chips, segmented controls, switches, cards and data tables from `src/components/index.ts`; MSW handlers for all 39 operations, with state for draft edits and job progress | A test fails if any `operationId` has no handler; each component has Vitest and axe tests |
| 5 | `[G] Web image and end-to-end harness` | A `web` image (the built frontend behind a reverse proxy that also proxies `/api`) in compose; Playwright in `frontend/tests/e2e/` against the compose stack, `--trace off` | One smoke test (the Matters list) passes in CI against the dry-run stack |

### Wave 2: build
| # | PR | Builds | Done when |
|---|---|---|---|
| 6 | `[B1] Custodians, sites, holds, drafts, versions` | Custodian and site endpoints; holds through the gateway; `GET/PUT .../draft`; `POST /kql/preview` (only through `searchtrail.query`); version creation; `GET .../versions` and `.../versions/compare` | Contract tests pass, including `422 criteria_invalid` |
| 7 | `[B2] The other five job handlers` | `preview` (items parsed with `report.py`, written with `add_preview_items`, files in storage), `term_report`, `export` (gated by `check_export`, accepted drift logged), `download` (streamed), `review_set`; Graph failures mapped to error codes | All six kinds pass in dry run, including blocked exports and count drift |
| 8 | `[B1] Job endpoints, results, exports, log` | The six `202` endpoints with `409 conflict`; `GET /jobs/{id}`, `GET .../jobs`; latest preview, item paging and filters, `items.csv`; latest term report; export list, detail and check, `confirmation_mismatch`; log, verify, and a log entry for every state change | Contract tests pass, including error codes; one test runs the whole flow through the API in dry run with `run_one`; `alembic check` is clean |
| 9 | `[D] Shell, job hook, error handling` | Side navigation, matter header and tabs; `useJob` and resuming active jobs; the `ErrorCode` to UI mapping; the `session_expired` redirect | Shell screenshot next to `Main.dc.html` |
| 10 | `[D] Data components and gallery` | Count tiles, bar breakdowns, month chart, methodology card, banners, empty and error states; `/_gallery` | The gallery shows every component; axe checks pass |
| 11–13 | `[E] Matters`, `[E] Define`, `[E] Scope` | Each screen to its design file | Each screen: works against the mocks and against `npm run dev:api`; Vitest tests for logic; a Playwright test per main action; a screenshot next to the design file |
| 14–17 | `[F] Preview`, `[F] Terms`, `[F] Export`, `[F] Log` | Each screen to its design file; Export adds download and review-set hand-offs | As for 11–13, including every blocked export state |

### Wave 3: M1
| # | PR | Builds | Done when |
|---|---|---|---|
| 18 | `[G] Full-flow end-to-end suite` | Playwright through the whole flow (create matter, custodians, scope, estimate, preview, terms, export, download, log verify) against the dry-run compose stack; the required-checks list for branch protection | Green in CI. **This is M1.** |

### After M1, toward M2 and M3
| # | PR | Builds |
|---|---|---|
| 19 | `[C] Sign-in and sessions` | Entra settings (PR note to B1 and G), PKCE sign-in, sessions and cookie, encrypted token cache with refresh, `current_user` replacing B1's stub, the per-user live gateway; tests that tokens never reach the browser |
| 20 | `[C] Live Graph calls` | `search_users`, holds, `add_to_review_set`, download hosts, the `ensure_user_source` fix, `/setup/check`, configurable cloud endpoints, admin notes for WS-G; unit-tested against recorded responses, no `GatewayNotImplemented` left |
| 21 | `[G] Security headers and install guide` | CSP, HSTS, cookie-flag tests; the install guide; CI caching and image builds |
| 22 | `[H] Live tenant validation` | Starts when a tenant and a person to sign in are available; leads to M2 |

## The B1 and B2 seams
Fixed now so both sides build against the same names. If the code shows a better shape, change it in
the PR that lands it and update this section in the same PR.

```python
# WS-B1, app/db/repositories/ (PR 1). WS-B2's handlers write to the database only through these.
def create_run(session, *, matter_id: str, query_version_id: str, kind: str,
               created_by: str | None) -> RunRow: ...
def finish_run(session, run: RunRow, *, status: str, counts: dict | None = None,
               result: dict | None = None, files: list[dict] | None = None) -> None: ...
def add_preview_items(session, run_id: str, items: Iterable[dict]) -> int: ...
    # batched inserts; dict keys are PreviewItemRow columns; returns the number written
def append_log(session, matter_id: str, action: LogAction, *, actor: str, actor_email: str | None,
               summary: str, version: int | None = None, **fields) -> AuditEntryRow: ...
    # locks the matter row, so appends are serialised per matter; same chain format as searchtrail/audit.py.
    # summary: the plain-English line the Log screen shows. version: the query version it's about.
    # Automatic steps use actor=SYSTEM_ACTOR ("SearchTrail") and actor_email=None.
def sources_fingerprint(session, matter_id: str) -> str: ...
    # SHA-256 of the custodians (email, mailbox, OneDrive, linked sites) and the sites without a
    # custodian; compare with QueryVersionRow.sources_fingerprint for the "same_sources" check.
# All of them flush and never commit: the caller (request or job handler) owns the transaction.

# WS-B2, app/jobs/export_checks.py (PR 2). The export job and B1's /exports/check both call it.
def check_export(session, gateway: PurviewGateway, matter_id: str) -> ExportCheck: ...
    # app.schemas.contract.ExportCheck. "previewed" and "same_sources" come from the database with no
    # Purview calls; "counts_unchanged" runs one estimate, only when both passed. No other Purview calls.
```

## Working rules for this phase
- One branch per PR (`ws-b1/matters`, `ws-e/scope`), cut from the latest `main`. If the PR before it
  isn't merged yet, the branch is stacked on it and the PR says so at the top. It's rebased onto
  `main` when its base merges.
- Before review: `ruff check .` and `pytest`; `npm run lint`, `npm run typecheck` and `npm test`;
  `python scripts/check_ownership.py --check-codeowners`. UI PRs include a screenshot next to the
  matching design file.
- The PR description says what's next, so review order is always clear.

## Risks and open questions
| Risk or question | Plan |
|---|---|
| `POST /exports/check` is synchronous but re-runs a Purview estimate, which can take minutes on a real tenant (section 2 of the V1 plan). The contract says "a few seconds". | Fine in dry run. WS-H measures it live; if it's slow, it becomes a job through a `[contract]` PR. |
| Review throughput: about 18 PRs to M1, all for one reviewer | Small PRs in dependency order; each says what it unblocks |
| Mock examples missing from the contract slow WS-D's PR 4 | If any are missing, one `[contract]` PR adds them all, before PR 4 |
