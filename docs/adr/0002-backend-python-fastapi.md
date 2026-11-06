# 0002. Backend: Python 3.12, FastAPI, Pydantic 2, SQLAlchemy 2, Alembic

- Status: Accepted
- Date: 2026-11-06

## Context
The working core (KQL builder, Graph eDiscovery calls, report parser, hash-chained log, dry run) is
Python. Rewriting it would throw away tested, defensibility-critical code.

## Decision
- The core stays a plain Python package, `backend/searchtrail/`, with no web dependencies. The CLI
  keeps working on it.
- The web API is FastAPI in `backend/app/`, in the same distribution, importing the core directly.
- Pydantic 2 models for requests and responses are generated from the contract (ADR 0006).
- SQLAlchemy 2 (typed `Mapped[...]` models) and Alembic for the schema. Models are portable enough to
  run unit tests on SQLite; Postgres-only behaviour has tests marked `postgres` that CI runs.
- Python 3.12 (the image and CI). Lint with ruff (pinned version).

## Consequences
- `app` may import `searchtrail`; `searchtrail` must never import `app`.
- One Docker image serves the API, worker and migrations (ADR 0010).
