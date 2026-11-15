# 0009. Tests: pytest, Vitest, Playwright

- Status: Accepted
- Date: 2026-11-06

## Decision
- Backend: pytest. Unit tests on SQLite; tests marked `postgres` need `SEARCHTRAIL_TEST_DATABASE_URL`
  (CI provides it). Purview behaviour is tested through `DryRunPurviewGateway`.
- Frontend: Vitest + Testing Library + MSW (node), in `frontend/tests/unit/`.
  Accessibility: `axe-core` runs in Vitest on every component and screen state (`tests/unit/a11y.ts`).
  jsdom can't measure colour contrast, so `tests/unit/tokens.test.ts` checks the contrast of every
  text and background pair the design uses. Mock responses are validated against the contract with
  Ajv (`tests/unit/contract.ts`).
- End to end: Playwright in `frontend/tests/e2e/` against the dry-run backend (WS-G sets this up;
  Phase 0 has none).
- Every PR: CI green (lint, type check, unit tests, contract drift, compose smoke test).
