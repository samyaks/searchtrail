# 0005. Database: PostgreSQL 16

- Status: Accepted
- Date: 2026-11-06

## Context
SearchTrail stores matters, query versions, previews (thousands of item rows), the log and jobs.
Customers run it in their own environment.

## Decision
PostgreSQL 16, run by the compose file or a managed service. JSONB for structured fields that mirror
the contract (criteria, counts, options). The first migration (`0001`) creates every table in
docs/V1_PLAN.md section 5.5.

## Consequences
- One dependency most IT teams already run and back up.
- Postgres-specific features are allowed (SKIP LOCKED, JSONB); unit tests use SQLite where they can.
