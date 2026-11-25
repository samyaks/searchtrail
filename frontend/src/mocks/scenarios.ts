// Switches that make the mock backend misbehave on purpose, so screens can be built and tested against
// the hard cases: a blocked export, a failed job, an expired session. Tests call setScenario(); in the
// browser, open the console and use window.stMocks (see browser.ts). Everything resets between tests.
import type { Schemas } from '@/api/client';

export type Scenario = {
  /** How long a job takes, in seconds of the mock clock. */
  jobSeconds: number;
  /** Jobs of these kinds end as failed, with the contract's purview_operation_failed example (worded for the kind of job). */
  failJobs: Schemas['JobKind'][];
  /** `countsChanged`: the export check finds new items since the preview and a real export is refused (unless accepted). */
  exportCheck: 'auto' | 'countsChanged';
  /** Placing or releasing a hold fails, with the contract's 502 example. */
  holdFails: boolean;
  /** Operations that need Purview are refused with the contract's 403 example for this code: labels, estimates, holds and
   * hand-offs when they are asked for; previews, term counts and exports (which the contract starts with no 403) as
   * jobs that fail at once with that error. */
  purviewDenied: false | 'purview_permission_missing' | 'license_missing';
  /** Microsoft is limiting requests: the directory search and the export check answer 429 (graph_throttled). */
  throttled: boolean;
  /** The health check reports the database unreachable (503). */
  databaseDown: boolean;
  /** The log fails verification at entry 5. */
  logTampered: boolean;
  /** Every request except /health and the two sign-in endpoints gets 401 session_expired. */
  sessionExpired: boolean;
};

const DEFAULTS: Scenario = {
  jobSeconds: 9,
  failJobs: [],
  exportCheck: 'auto',
  holdFails: false,
  purviewDenied: false,
  throttled: false,
  databaseDown: false,
  logTampered: false,
  sessionExpired: false,
};

export let scenario: Scenario = { ...DEFAULTS };
export const setScenario = (changes: Partial<Scenario>) => {
  scenario = { ...scenario, ...changes };
};
export const resetScenario = () => {
  scenario = { ...DEFAULTS };
};
