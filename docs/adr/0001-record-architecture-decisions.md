# 0001. Record architecture decisions

- Status: Accepted
- Date: 2026-11-06

## Context
Several agents will build SearchTrail V1 in parallel (docs/V1_PLAN.md section 3). They need the
reasons behind each technical choice, not just the choice, so they don't relitigate or quietly undo it.

## Decision
Record each significant decision as a short ADR in `docs/adr/`, numbered in order, with Context,
Decision and Consequences. A decision is changed by a new ADR that supersedes the old one; old ADRs
are not edited except to mark them superseded.

## Consequences
- Anyone proposing a change to the stack, the contract process or the gateway writes an ADR in the
  same PR.
- `docs/adr/README.md` lists every ADR and any place Phase 0 departed from the plan.
