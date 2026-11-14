// A tiny client for the mock backend tests: real fetch calls, answered by MSW, like a screen's would be.
import { API_BASE } from '@/api/client';

export type Reply = { status: number; json: any; text: string; headers: Headers }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** The text as JSON, or null if it is empty or not JSON (a CSV, a redirect). */
function parseJson(text: string): unknown {
  try {
    return text ? JSON.parse(text) : null;
  } catch {
    return null;
  }
}

export async function call(method: string, path: string, options: { body?: unknown; query?: Record<string, string | number | boolean> } = {}): Promise<Reply> {
  const query = options.query ? `?${new URLSearchParams(Object.entries(options.query).map(([k, v]) => [k, String(v)]))}` : '';
  const response = await fetch(`${API_BASE}${path}${query}`, {
    method,
    redirect: 'manual',
    headers: options.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, json: parseJson(text), text, headers: response.headers };
}

export const get = (path: string, query?: Record<string, string | number | boolean>) => call('GET', path, { query });
export const post = (path: string, body?: unknown) => call('POST', path, { body });
export const put = (path: string, body?: unknown) => call('PUT', path, { body });
export const patch = (path: string, body?: unknown) => call('PATCH', path, { body });
export const del = (path: string) => call('DELETE', path);

/** Poll a job (as a screen's useJob will) until it is done; returns every state it passed through. */
export async function runJob(jobId: string, maxPolls = 20) {
  const states: Reply['json'][] = [];
  for (let i = 0; i < maxPolls; i += 1) {
    const { json } = await get(`/jobs/${jobId}`);
    states.push(json);
    if (json.status === 'succeeded' || json.status === 'failed') break;
  }
  return states;
}

export const FALCON = 'mat_falcon';
export const ALEX = '3c1a7f5e-0000-4000-8000-0000000000a1';
export const MEGAN = '3c1a7f5e-0000-4000-8000-0000000000b2';
export const HANNAH = '3c1a7f5e-0000-4000-8000-0000000000c3';
export const FALCON_EXPORT = 'exp_falcon_v2'; // the finished export in the contract's examples
export const FALCON_PREVIEW = 'prv_falcon_v3';
