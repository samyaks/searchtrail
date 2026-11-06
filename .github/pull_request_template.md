<!-- Title: start with the workstream, e.g. "[B1] Matters endpoints", "[E] Scope live KQL",
     or "[contract] Add matter archive". The ownership check reads it. -->

## What and why


## Workstream
- [ ] This PR stays inside my workstream's paths (`.github/ownership.yml`), **or** I've explained
      below why it touches another workstream and asked that owner to review.

## Contract
- [ ] No change to `contracts/openapi.yaml` or `backend/searchtrail/gateway.py`, **or** this is a
      `[contract]` PR with regenerated code (`scripts/codegen.sh`) and both gateway implementations updated.

## Checks
- [ ] Tests added or updated, and they pass locally
- [ ] Works with `SEARCHTRAIL_DRY_RUN=1`; any new Purview call has a `DryRunTransport` answer
- [ ] Docs or brief updated if behaviour or setup changed
- [ ] UI: screenshot below, next to the matching file in `docs/design/`
