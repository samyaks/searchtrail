// MSW request handlers: a stateful mock of the whole API (docs/adr/0008-msw-mocks-from-contract.md).
// One handler per operation in contracts/openapi.yaml; a test fails if one is missing, and another checks
// every response against the contract's schemas. The data is the contract's examples (src/mocks/examples.json),
// and it changes as the screens act: edit a draft, start an estimate, poll its job, run an export.
import { criteriaHandlers } from './handlers/criteria';
import { exportHandlers } from './handlers/exports';
import { historyHandlers, jobHandlers } from './handlers/history';
import { matterHandlers } from './handlers/matters';
import { runHandlers } from './handlers/runs';
import { systemHandlers } from './handlers/system';

export const handlers = [...systemHandlers, ...matterHandlers, ...criteriaHandlers, ...runHandlers, ...exportHandlers, ...historyHandlers, ...jobHandlers];
