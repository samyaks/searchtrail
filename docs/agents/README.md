# Agent briefs

One brief per workstream. Each is self-contained: hand the file to the agent. All start once Phase 0 is merged.

| Workstream | Owns |
|---|---|
| [WS-B1 · Backend API and data](B1-backend-api-and-data.md) | `backend/app/api/`, `backend/app/schemas/` (hand-written helpers only; `contract.py` is generated), `backend/app/db/` (models, migrations, repositories) |
| [WS-B2 · Jobs and Purview workflow](B2-jobs-and-purview-workflow.md) | `backend/app/jobs/`, `backend/searchtrail/workflow.py`, `backend/app/storage/` |
| [WS-C · Microsoft sign-in and Graph](C-microsoft-signin-and-graph.md) | `backend/app/auth/`, `backend/app/microsoft/`, `backend/searchtrail/graph.py`, `backend/searchtrail/dryrun.py`, `backend/searchtrail/gateway_graph.py`, `backend/searchtrail/gateway_dryrun.py`, `backend/searchtrail/auth.py`, `backend/searchtrail/config.py` |
| [WS-D · Frontend foundation and components](D-frontend-foundation-and-components.md) | `frontend/src/app/`, `frontend/src/components/`, `frontend/src/api/` (except generated `schema.d.ts`), `frontend/src/mocks/` (except generated `examples.json`), `frontend/src/styles/` |
| [WS-E · Screens: Matters, Define, Scope](E-screens-matters-define-scope.md) | `frontend/src/screens/matters/`, `frontend/src/screens/define/`, `frontend/src/screens/scope/` |
| [WS-F · Screens: Preview, Terms, Export, Log](F-screens-preview-terms-export-log.md) | `frontend/src/screens/preview/`, `frontend/src/screens/terms/`, `frontend/src/screens/export/`, `frontend/src/screens/log/` |
| [WS-G · Quality, packaging and docs](G-quality-packaging-docs.md) | `deploy/`, `.github/workflows/`, `frontend/tests/e2e/`, `docs/install/` |
| [WS-H · Live tenant validation (an agent plus a human with tenant access)](H-live-tenant-validation.md) | `backend/tests/fixtures/live/`, `docs/validation/` |

Shared, integrator-approved only: `contracts/openapi.yaml`, `backend/searchtrail/gateway.py`, generated code.
