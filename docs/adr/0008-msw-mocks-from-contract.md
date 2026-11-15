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
- There is one handler per operation, and the mock backend is stateful (`src/mocks/db.ts`): matters,
  custodians, holds, drafts, query versions, jobs, exports and the log change as screens use them.
  A job moves on every poll and changes the data when it finishes, as the real backend does.
  `src/mocks/scenarios.ts` has switches for the hard cases (blocked exports, failed jobs, Purview
  refusals, an expired session), for tests and, through `window.stMocks`, for trying by hand.
- Tests keep the mocks honest: one fails if an operation has no handler, and another calls every
  operation and validates each response against the contract's own schemas (Ajv), and checks that every
  status the contract defines is reached. The mocks' sample people are the same as the backend's
  dry-run directory, which a test also checks.
- The API client looks up `fetch` per call, so MSW can intercept it.

## Consequences
- Adding realistic mock data means adding an example to the contract (a contract PR), which also
  documents the API. Matters other than the contract's Falcon matter have no detailed examples, so
  their details are derived from their list entry (with filler custodians past the six sample people);
  the KQL builder and the item table are stand-ins, not the backend's.
- MSW never ships in the production build (checked).
