// Sign-in. The API runs the Microsoft sign-in (a redirect to /auth/login) and keeps the session in a cookie,
// so the browser's part is only to go there when a request says the session has ended.
import { ApiRequestError } from './client';

export const LOGIN_PATH = '/api/v1/auth/login';

/** Where the app is now, as a path the API can send the person back to after signing in. */
function here(): string {
  const { pathname, search, hash } = globalThis.location ?? { pathname: '/', search: '', hash: '' };
  return `${pathname}${search}${hash}`;
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

/**
 * Send the person to sign in, once: several requests failing at the same moment must not start several
 * navigations. Does nothing if the page is already part of the sign-in.
 */
export function redirectToLogin(): void {
  if (redirecting || globalThis.location?.pathname.startsWith('/api/')) return;
  redirecting = true;
  sessionNavigation.assign(loginUrl());
}

/** For tests: forget that a redirect has started. */
export function resetRedirect(): void {
  redirecting = false;
}

/** Called for every failed query and mutation (see queryClient.ts): an ended session goes to sign-in. */
export function handleSessionExpired(error: unknown): void {
  if (error instanceof ApiRequestError && error.body.code === 'session_expired') redirectToLogin();
}
