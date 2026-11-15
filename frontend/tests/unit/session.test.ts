import { QueryClient } from '@tanstack/react-query';
import { ApiRequestError, type ApiError } from '@/api/client';
import { loginUrl, redirectToLogin, resetRedirect, sessionNavigation } from '@/api/session';
import { makeQueryClient, retryOnce } from '@/app/queryClient';
import { setScenario } from '@/mocks/scenarios';
import { renderApp } from './renderApp';

const apiError = (code: string, status: number) => new ApiRequestError(status, { code, message: 'x', details: {} } as ApiError);

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  resetRedirect();
  assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
  window.history.pushState({}, '', '/matters/mat_falcon/scope?tab=terms');
});
afterEach(() => {
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

const RETURN_TO = '/api/v1/auth/login?return_to=%2Fmatters%2Fmat_falcon%2Fscope%3Ftab%3Dterms';

test('the sign-in URL comes back to a given path, escaped', () => {
  expect(loginUrl('/matters?stage=exported&x=1#top')).toBe('/api/v1/auth/login?return_to=%2Fmatters%3Fstage%3Dexported%26x%3D1%23top');
});

test('a failed query with an ended session sends the person to sign in, back to the page they were on', async () => {
  const client = makeQueryClient();
  await client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(apiError('session_expired', 401)) }).catch(() => {});
  expect(assign).toHaveBeenCalledExactlyOnceWith(RETURN_TO);
});

test('so does a failed mutation', async () => {
  const client = makeQueryClient();
  await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(apiError('session_expired', 401)) }).execute(undefined).catch(() => {});
  expect(assign).toHaveBeenCalledExactlyOnceWith(RETURN_TO);
});

test('several requests failing together start one sign-in, not several', async () => {
  const client = makeQueryClient();
  await Promise.all(
    ['a', 'b', 'c'].map((key) => client.fetchQuery({ queryKey: [key], queryFn: () => Promise.reject(apiError('session_expired', 401)) }).catch(() => {})),
  );
  expect(assign).toHaveBeenCalledTimes(1);
});

test('other errors do not sign anyone out', async () => {
  const client = makeQueryClient();
  for (const [code, status] of [['not_found', 404], ['conflict', 409], ['internal_error', 500], ['purview_permission_missing', 403]] as const) {
    await client.fetchQuery({ queryKey: [code], queryFn: () => Promise.reject(apiError(code, status)) }).catch(() => {});
  }
  await client.fetchQuery({ queryKey: ['network'], queryFn: () => Promise.reject(new TypeError('Failed to fetch')) }).catch(() => {});
  expect(assign).not.toHaveBeenCalled();
});

test('a page that is part of the sign-in does not redirect again', () => {
  window.history.pushState({}, '', '/api/v1/auth/callback?code=x');
  redirectToLogin();
  expect(assign).not.toHaveBeenCalled();
});

test('the whole app, when the session has ended: every request fails, and one sign-in starts', async () => {
  setScenario({ sessionExpired: true });
  renderApp('/matters');
  await vi.waitFor(() => expect(assign).toHaveBeenCalled());
  await new Promise((resolve) => setTimeout(resolve, 100)); // let the other failing requests (/me, /matters) finish too
  expect(assign).toHaveBeenCalledExactlyOnceWith(RETURN_TO);
});

test('a request is retried once if it might work next time, never if the server said no', () => {
  const error = (status: number) => new ApiRequestError(status, { code: 'internal_error', message: 'x', details: {} });
  expect(retryOnce(0, error(500))).toBe(true);
  expect(retryOnce(1, error(500))).toBe(false);
  expect(retryOnce(0, new TypeError('Failed to fetch'))).toBe(true);
  for (const status of [400, 401, 403, 404, 409, 429]) expect(retryOnce(0, error(status)), String(status)).toBe(false);
});

test('the client does not refetch on window focus, and applies the retry rule', () => {
  const client: QueryClient = makeQueryClient();
  expect(client.getDefaultOptions().queries).toMatchObject({ refetchOnWindowFocus: false, retry: retryOnce });
});
