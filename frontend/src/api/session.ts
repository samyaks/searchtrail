// Sign-in. The API runs the Microsoft sign-in (a redirect to /auth/login) and keeps the session in a cookie.
// When a request says the session has ended (401 session_expired), the app says so and offers Sign in
// (app/Shell.tsx); it doesn't jump away by itself, so nothing on screen is lost without the person choosing to go.
import { type QueryClient, useQuery } from '@tanstack/react-query';
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

/** Whether a request found the session ended, kept in the query cache so every part of the app sees the same. */
const ENDED_KEY = ['session', 'ended'] as const;

export function isSessionExpired(error: unknown): boolean {
  return error instanceof ApiRequestError && error.body.code === 'session_expired';
}

/** Called for every failed query and mutation (see queryClient.ts): an ended session is noted for the Shell to show. */
export function noteSessionEnded(client: QueryClient, error: unknown): void {
  if (isSessionExpired(error) && client.getQueryData(ENDED_KEY) !== true) client.setQueryData(ENDED_KEY, true);
}

/** True once any request has found the session ended, until the person signs in again. */
export function useSessionEnded(): boolean {
  const { data } = useQuery({ queryKey: ENDED_KEY, queryFn: () => false, enabled: false, initialData: false, staleTime: Infinity, gcTime: Infinity });
  return data;
}

/**
 * How Sign in works without the real API: the mocks (mocks/browser.ts) set one that starts a new mock session, so
 * the demo recovers in place. Without one, Sign in goes to the API's sign-in, a full page load.
 */
let signInHere: (() => void) | null = null;
export function setSignInHere(fn: (() => void) | null): void {
  signInHere = fn;
}
export const signsInHere = () => signInHere !== null;

/**
 * Sign in again. With the real API: go to its sign-in, which comes back to this page. With the mocks: start a new
 * mock session, then load again everything that failed, without leaving the page.
 */
export function signIn(client: QueryClient | undefined): void {
  if (signInHere && client) {
    signInHere();
    client.setQueryData(ENDED_KEY, false);
    void client.invalidateQueries(); // the ended-session flag itself is never fetched, so it stays false
    return;
  }
  sessionNavigation.assign(loginUrl());
}
