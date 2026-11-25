// The contract's own error bodies for the switches in scenarios.ts, so a screen is built against exactly what
// the API documents for these cases.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { example } from './examples';
import { scenario } from './scenarios';

/** The contract's 403 body for `operationId` with the code the scenario names (its role or licence example). */
function denialBody(operationId: string, wanted: Schemas['ErrorCode']): Schemas['Error'] {
  for (const name of ['role', 'licence']) {
    const body = example<Schemas['Error']>(operationId, '403', name);
    if (body.code === wanted) return body;
  }
  return example<Schemas['Error']>(operationId, '403');
}

/** The 403 for `operationId` if the scenario says Purview denies it: the contract's example with that error code. */
export function deniedByPurview(operationId: string): Response | undefined {
  if (!scenario.purviewDenied) return undefined;
  return HttpResponse.json(denialBody(operationId, scenario.purviewDenied), { status: 403 });
}

/**
 * Why a job that works in Purview fails when the scenario says Purview denies it, or undefined. A preview, a term
 * count and an export are started (202, as the contract has no 403 for them) and then fail at once with the
 * permission error, as the backend's jobs do when Purview refuses (app/jobs/steps.py). The others are refused when
 * they are asked for (deniedByPurview).
 */
export function jobDeniedByPurview(): Schemas['Error'] | undefined {
  return scenario.purviewDenied ? denialBody('startEstimate', scenario.purviewDenied) : undefined;
}

/** The 429 for `operationId` if Microsoft is throttling. */
export function throttledByMicrosoft(operationId: string): Response | undefined {
  return scenario.throttled ? HttpResponse.json(example<Schemas['Error']>(operationId, '429'), { status: 429 }) : undefined;
}
