# Architecture decision records

| # | Decision | Status |
|---|---|---|
| [0001](0001-record-architecture-decisions.md) | Record architecture decisions | Accepted |
| [0002](0002-backend-python-fastapi.md) | Backend: Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic | Accepted |
| [0003](0003-jobs-in-postgres.md) | Background jobs in a Postgres table | Accepted |
| [0004](0004-auth-backend-for-frontend.md) | Auth: backend-for-frontend with delegated Entra sign-in | Accepted (to be built by WS-C) |
| [0005](0005-postgresql.md) | Database: PostgreSQL 16 | Accepted |
| [0006](0006-contract-first-openapi.md) | Contract first: contracts/openapi.yaml is the source of truth | Accepted |
| [0007](0007-frontend-stack.md) | Frontend: React 18, TypeScript, Vite, React Router, TanStack Query | Accepted |
| [0008](0008-msw-mocks-from-contract.md) | Frontend mocks: MSW handlers serving the contract's examples | Accepted |
| [0009](0009-testing.md) | Tests: pytest, Vitest, Playwright | Accepted |
| [0010](0010-packaging-docker-compose.md) | Packaging: Docker images and Docker Compose | Accepted |
| [0011](0011-purview-gateway-location.md) | PurviewGateway lives in the core package | Accepted |
| [0012](0012-offline-dry-run-mode.md) | Offline mode: SEARCHTRAIL_DRY_RUN=1 | Accepted |

## Where Phase 0 departed from docs/V1_PLAN.md

- **Gateway location:** the interface and both implementations live in the core package, not `app/microsoft/` (ADR 0011).
- **Pydantic models are generated** from the contract instead of hand-written and checked (ADR 0006).
- **First migration creates all tables** from section 5.5; the plan's table said "empty first migration" while section 5.5 calls it the first migration's data model. The tables are there so WS-B1 and WS-B2 start from one schema.
- **Hold body is `{"on_hold": bool}`**: `on` is a YAML 1.1 boolean and broke the example in Python tooling (ADR 0006).
- **No `web` image yet** (ADR 0010); WS-G adds it.
- **TypeScript 5.9, not 7**, and self-hosted fonts (ADR 0007).
- **The worker builds the gateway per job** (the live one acts as the job's user), so it starts even before live access exists.
- **`/health` is in the contract** (plan section 5.1 didn't list it; Phase 0 needs it).
- **Extra generic error codes** `validation_failed`, `not_found`, `conflict`, `internal_error` alongside the nine in section 5.3.
