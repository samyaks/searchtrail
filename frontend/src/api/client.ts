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

/** True for a body in the contract's Error shape. */
function isApiError(value: unknown): value is ApiError {
  const body = value as Partial<ApiError> | null;
  return typeof body === 'object' && body !== null && typeof body.code === 'string' && typeof body.message === 'string';
}

/** The code the API uses for a status (backend app/api/errors.py), for a response that didn't say. */
function codeFor(status: number): Schemas['ErrorCode'] {
  if (status === 401) return 'session_expired';
  if (status === 404) return 'not_found';
  if (status === 409) return 'conflict';
  return status >= 400 && status < 500 ? 'validation_failed' : 'internal_error';
}

/**
 * Unwrap an openapi-fetch result: return the data or throw ApiRequestError. An error without the
 * contract's Error body (a proxy's HTML 502 while the API restarts, an empty 503) still gets a code and
 * a message a screen can show.
 */
export function unwrap<T>(result: { data?: T; error?: unknown; response: Response }): T {
  // A successful 204 (logout, DELETE) has no data; only a non-2xx response is an error.
  if (result.error !== undefined || !result.response.ok) {
    const { status } = result.response;
    const body: ApiError = isApiError(result.error)
      ? { ...result.error, details: result.error.details ?? {} }
      : {
          code: codeFor(status),
          message:
            status >= 500 || status === 0
              ? `SearchTrail's server didn't answer properly (${status}). Try again in a moment.`
              : `The request failed (${status}).`,
          details: {},
        };
    throw new ApiRequestError(status, body);
  }
  return result.data as T;
}
