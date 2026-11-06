// The typed API client. Types come from src/api/schema.d.ts, generated from
// contracts/openapi.yaml (npm run gen:api). The session cookie is sent automatically.
import createClient from 'openapi-fetch';
import type { components, paths } from './schema';

// Absolute so it also works under Node (Vitest); same origin as the app in the browser.
export const API_BASE = `${globalThis.location?.origin ?? 'http://localhost'}/api/v1`;

export const api = createClient<paths>({
  baseUrl: API_BASE,
  credentials: 'same-origin',
  // Look fetch up on each call, so MSW (which patches globalThis.fetch after import) can intercept it.
  fetch: (request) => globalThis.fetch(request),
});

export type Schemas = components['schemas'];
export type ApiError = Schemas['Error'];

/** Thrown by query hooks when the API returns an Error body (docs/V1_PLAN.md section 5.3). */
export class ApiRequestError extends Error {
  constructor(
    readonly status: number,
    readonly body: ApiError,
  ) {
    super(body.message);
  }
}

/** Unwrap an openapi-fetch result: return the data or throw ApiRequestError. */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  if (result.error !== undefined || result.data === undefined) {
    const body = (result.error as ApiError | undefined) ?? {
      code: 'internal_error',
      message: `Request failed (${result.response.status})`,
      details: {},
    };
    throw new ApiRequestError(result.response.status, body);
  }
  return result.data;
}
