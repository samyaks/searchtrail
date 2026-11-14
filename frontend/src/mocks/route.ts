// How handlers are declared: every one goes through route(), which applies the scenario switches that
// affect all endpoints (an expired session) before the handler runs.
import { http, type HttpHandler } from 'msw';
import { findMatter, type MockMatter } from './db';
import { scenario } from './scenarios';
import { notFound, sessionExpired } from './util';

export const API = '/api/v1';
/** Endpoints that work without a session: the health check, and the two that create one. */
const PUBLIC = ['/health', '/auth/login', '/auth/callback'];

type Method = 'get' | 'post' | 'put' | 'patch' | 'delete';
type Params = Record<string, string | readonly string[] | undefined>;
export type Context = { params: Params; request: Request; url: URL };

/** `path` is the contract's path with :params, such as "/matters/:matterId/draft". */
export function route(method: Method, path: string, resolver: (context: Context) => Response | Promise<Response>): HttpHandler {
  return http[method](`${API}${path}`, async ({ params, request }) => {
    if (scenario.sessionExpired && !PUBLIC.includes(path)) return sessionExpired();
    return resolver({ params, request, url: new URL(request.url) });
  });
}

const param = (value: string | readonly string[] | undefined) => (Array.isArray(value) ? value[0] : (value as string | undefined)) ?? '';

/** Run `then` with the matter named by :matterId, or answer 404. */
export function withMatter(context: Context, then: (matter: MockMatter) => Response | Promise<Response>) {
  const matter = findMatter(param(context.params.matterId));
  return matter ? then(matter) : notFound('matter');
}

export const idParam = (context: Context, name: string) => param(context.params[name]);

/** The JSON body of a request, or undefined if it isn't valid JSON. */
export async function readJson(request: Request): Promise<Record<string, unknown> | undefined> {
  try {
    const body: unknown = await request.json();
    return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}
