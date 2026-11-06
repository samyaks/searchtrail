# 0008. Frontend mocks: MSW handlers serving the contract's examples

- Status: Accepted
- Date: 2026-11-06

## Context
Frontend agents must not wait for the backend, and mocked data must not drift from the contract.

## Decision
- MSW 2 runs in development (`npm run dev`) and in Vitest. `npm run dev:api` turns it off and
  proxies `/api` to the backend.
- Handlers return the contract's own examples (`src/mocks/examples.json`, generated), via
  `example(operationId, status, name)`. Richer behaviour (filters, state) lives in the handler.
- The API client looks up `fetch` per call, so MSW can intercept it.

## Consequences
- Adding realistic mock data means adding an example to the contract (a contract PR), which also
  documents the API.
- MSW never ships in the production build (checked).
