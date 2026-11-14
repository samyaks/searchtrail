// The contract's own error bodies for the switches in scenarios.ts, so a screen is built against exactly what
// the API documents for these cases.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { example } from './examples';
import { scenario } from './scenarios';

/** The 403 for `operationId` if the scenario says Purview denies it: the contract's example with that error code. */
export function deniedByPurview(operationId: string): Response | undefined {
  if (!scenario.purviewDenied) return undefined;
  const wanted = scenario.purviewDenied;
  for (const name of ['role', 'licence']) {
    const body = example<Schemas['Error']>(operationId, '403', name);
    if (body.code === wanted) return HttpResponse.json(body, { status: 403 });
  }
  return HttpResponse.json(example<Schemas['Error']>(operationId, '403'), { status: 403 });
}

/** The 429 for `operationId` if Microsoft is throttling. */
export function throttledByMicrosoft(operationId: string): Response | undefined {
  return scenario.throttled ? HttpResponse.json(example<Schemas['Error']>(operationId, '429'), { status: 429 }) : undefined;
}
