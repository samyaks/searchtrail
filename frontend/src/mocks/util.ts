// Small helpers for the mock backend: time, ids, hashes and responses.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';

// -- time ---------------------------------------------------------------------------------------------
let fixedNow: Date | null = null;
/** The mock backend's clock. Tests fix it with setNow(); in the browser it is the real time. */
export const now = () => fixedNow ?? new Date();
export const setNow = (date: Date | null) => {
  fixedNow = date;
};
export const iso = (date: Date = now()) => date.toISOString().replace(/\.\d{3}Z$/, 'Z');

// -- ids ----------------------------------------------------------------------------------------------
let counter = 0;
export const resetIds = () => {
  counter = 0;
};
/** A readable, unique id such as "mat_1" or "job_3". */
export const nextId = (prefix: string) => `${prefix}_${++counter}`;

// -- hashes -------------------------------------------------------------------------------------------
/** A stand-in for SHA-256: 64 hex characters, the same for the same text. The real log uses SHA-256 (backend). */
export function fakeHash(text: string): string {
  let out = '';
  for (let seed = 1; out.length < 64; seed += 1) {
    let h = 0x811c9dc5 ^ seed;
    for (let i = 0; i < text.length; i += 1) h = Math.imul(h ^ text.charCodeAt(i), 0x01000193);
    out += (h >>> 0).toString(16).padStart(8, '0');
  }
  return out.slice(0, 64);
}
/** A small whole number from text, for numbers that should be the same every time. */
export const hashNumber = (text: string) => parseInt(fakeHash(text).slice(0, 8), 16);

// -- responses ----------------------------------------------------------------------------------------
export function error(status: number, code: Schemas['ErrorCode'], message: string, details: Record<string, unknown> = {}) {
  return HttpResponse.json({ code, message, details } satisfies Schemas['Error'], { status });
}
export const notFound = (what = 'matter') => error(404, 'not_found', `No ${what} with that ID.`);
export const sessionExpired = () => error(401, 'session_expired', 'Your session has ended. Sign in again to continue.');
export const validationFailed = (field: string, message: string) => error(400, 'validation_failed', message, { field });

export const clone = <T>(value: T): T => structuredClone(value);

/** Items `page` of `size` (1-based), as the contract's paged lists return them. */
export function paginate<T>(all: T[], page: number, pageSize: number) {
  const start = (page - 1) * pageSize;
  return { items: all.slice(start, start + pageSize), total: all.length, page, page_size: pageSize };
}
export function pageParams(url: URL, defaultSize: number) {
  const page = Math.max(1, Number(url.searchParams.get('page')) || 1);
  const size = Math.min(200, Math.max(1, Number(url.searchParams.get('page_size')) || defaultSize));
  return { page, size };
}
