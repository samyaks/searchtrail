// Sign-in. The API runs the Microsoft sign-in (a redirect to /auth/login) and keeps the session in a cookie,
// so the browser's part is only to go there when a request says the session has ended.
import { ApiRequestError } from './client';

export const LOGIN_PATH = '/api/v1/auth/login';

/** Where the app is now, as a path the API can send the person back to after signing in. */
function here(): string {
  const { pathname, search, hash } = globalThis.location ?? { pathname: '/', search: '', hash: '' };
  // One leading slash, never two: "//host/x" would read as another site. (The API checks return_to too.)
  return `/${pathname.replace(/^\/+/, '')}${search}${hash}`;
}

/** The sign-in URL; `returnTo` is where the person lands afterwards (default: the page they're on). */
export function loginUrl(returnTo: string = here()): string {
  return `${LOGIN_PATH}?return_to=${encodeURIComponent(returnTo)}`;
}

/** The browser's navigation, separate so tests can watch it. */
export const sessionNavigation = {
  assign: (url: string) => globalThis.location.assign(url),
};

let redirecting = false;

/** When this tab last went to sign in, kept across page loads (sessionStorage is per tab). */
const STARTED_KEY = 'searchtrail.signInStartedAt';
/** A sign-in started this recently that ends in an ended session again didn't take (blocked cookies, say). */
export const SIGN_IN_GRACE_MS = 2 * 60_000;

function signInStartedAt(): number | null {
  try {
    const value = Number(globalThis.sessionStorage?.getItem(STARTED_KEY));
    return Number.isFinite(value) && value > 0 ? value : null;
  } catch {
    return null; // storage blocked: no guard across page loads, but still one redirect per page
  }
}

function rememberSignInStarted(now: number): void {
  try {
    globalThis.sessionStorage?.setItem(STARTED_KEY, String(now));
  } catch {
    // storage blocked: see above
  }
}

/**
 * Send the person to sign in, once: several requests failing at the same moment must not start several
 * navigations. Does nothing if the page is already part of the sign-in, or if this tab went to sign in moments
 * ago and the session has ended again: going round again would loop, so the screen's "Sign in" notice is left
 * for the person to press instead.
 */
export function redirectToLogin(now: number = Date.now()): void {
  if (redirecting || globalThis.location?.pathname.startsWith('/api/')) return;
  const started = signInStartedAt();
  if (started !== null && now - started < SIGN_IN_GRACE_MS) return;
  redirecting = true;
  rememberSignInStarted(now);
  sessionNavigation.assign(loginUrl());
}

/**
 * For tests: forget that a redirect has started, in this page and across page loads. `pageOnly` forgets only this
 * page's, as a new page load does.
 */
export function resetRedirect({ pageOnly = false }: { pageOnly?: boolean } = {}): void {
  redirecting = false;
  if (pageOnly) return;
  try {
    globalThis.sessionStorage?.removeItem(STARTED_KEY);
  } catch {
    // nothing to forget
  }
}

/** Called for every failed query and mutation (see queryClient.ts): an ended session goes to sign-in. */
export function handleSessionExpired(error: unknown): void {
  if (error instanceof ApiRequestError && error.body.code === 'session_expired') redirectToLogin();
}
