# 0006. Contract first: contracts/openapi.yaml is the source of truth

- Status: Accepted
- Date: 2026-11-06

## Context
Frontend and backend agents work in parallel. They need one definition of every request,
response, error and example, and a way to notice drift immediately.

## Decision
- `contracts/openapi.yaml` (OpenAPI 3.1) defines every endpoint in V1_PLAN 5.1, the job model and
  the error codes, with examples taken from the design files. It must pass Spectral (`spectral:oas`,
  examples validated against schemas, no warnings).
- Everything else is **generated** from it by `scripts/codegen.sh`:
  - `backend/app/schemas/contract.py`: Pydantic models (datamodel-code-generator, pinned)
  - `frontend/src/api/schema.d.ts`: TypeScript types (openapi-typescript, locked)
  - `frontend/src/mocks/examples.json`: the examples, for MSW (ADR 0008)
- CI regenerates and fails on any diff. Backend tests check every served route is in the contract
  with the same operationId and response model, every JSON example validates against the generated
  models, and the KQL example equals `query.py`'s real output.
- Changes go through a small contract PR approved by the integrator, with regenerated code.

## Departure from the plan
The plan said Pydantic models would be "checked against" the contract. Generating them is
stricter and removes a whole class of drift, so routes use the generated models directly.

## Consequences
- Never edit generated files. Field names are `snake_case`; avoid YAML 1.1 booleans as keys
  (`on`, `off`, `yes`, `no`): that is why the hold body is `{ "on_hold": true }`.
