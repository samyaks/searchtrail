# Working on SearchTrail

Several workstreams (docs/agents/) build V1 in parallel. These rules keep them in sync.

## Who owns what
`.github/ownership.yml` maps every path to a workstream (B1, B2, C, D, E, F, G, H), to the shared
contract, to generated files, or to shared integrator files. `.github/CODEOWNERS` is generated from
it (`python scripts/check_ownership.py --write-codeowners`), so GitHub asks the right owner to review.

Stay in your paths. If you must touch another workstream's, say why in the PR and get its owner's
review. The ownership check in CI warns when a PR crosses workstreams.

## Branches and PR titles
- One branch (and git worktree) per workstream task: `ws-b1/matters-endpoints`, `ws-e/scope-kql`.
- PR titles start with the workstream: `[B1] Matters endpoints`. Contract PRs start with `[contract]`.
- Small PRs into `main`. CI must be green: backend, frontend, contract drift, compose smoke test and
  the ownership check.
- Rebase or merge `main` into your branch at least daily, and before asking for review.

## Changing the contract
The contract is `contracts/openapi.yaml` plus the `PurviewGateway` interface
(`backend/searchtrail/gateway.py`). To change it:
1. Open a separate PR titled `[contract] ...`. Don't mix it with feature work (CI fails if you do).
2. Edit the contract, then run `scripts/codegen.sh` and commit the regenerated files. For the gateway,
   update both implementations and their tests.
3. Say in the PR who is affected (which workstreams) and how.
4. The integrator approves and merges it. Then everyone affected merges `main` into their branch and
   regenerates nothing by hand: the generated files come with `main`.

Never edit generated files (`backend/app/schemas/contract.py`, `frontend/src/api/schema.d.ts`,
`frontend/src/mocks/examples.json`); CI regenerates them and fails on any difference.

## Merge order
When PRs collide: contract, then backend core and DB, gateway, frontend components, screens,
end-to-end tests. Later PRs merge `main` and resolve.

## Decisions
A change to the stack, the contract process or the gateway's shape gets an ADR in `docs/adr/` in the
same PR.

## Before you push
```bash
cd backend && ruff check . && pytest
cd frontend && npm run lint && npm run typecheck && npm test
python scripts/check_ownership.py --check-codeowners
```
