# 0009. Tests: pytest, Vitest, Playwright

- Status: Accepted
- Date: 2026-11-06

## Decision
- Backend: pytest. Unit tests on SQLite; tests marked `postgres` need `SEARCHTRAIL_TEST_DATABASE_URL`
  (CI provides it). Purview behaviour is tested through `DryRunPurviewGateway`.
- Frontend: Vitest + Testing Library + MSW (node), in `frontend/tests/unit/`.
- End to end: Playwright in `frontend/tests/e2e/` against the dry-run backend (WS-G sets this up;
  Phase 0 has none).
- Every PR: CI green (lint, type check, unit tests, contract drift, compose smoke test).
