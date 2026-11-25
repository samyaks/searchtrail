import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ApiRequestError, type ApiError } from '@/api/client';
import { loginUrl, sessionNavigation, setSignInHere, signIn } from '@/api/session';
import { makeQueryClient, retryOnce } from '@/app/queryClient';
import { ErrorNotice } from '@/components';
import { setScenario } from '@/mocks/scenarios';
import { expectNoA11yViolations } from './a11y';
import { renderApp } from './renderApp';

const apiError = (code: string, status: number) => new ApiRequestError(status, { code, message: 'x', details: {} } as ApiError);

let assign: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  assign = vi.spyOn(sessionNavigation, 'assign').mockImplementation(() => {});
  window.history.pushState({}, '', '/matters/mat_falcon/scope?tab=terms');
});
afterEach(() => {
  setSignInHere(null);
  window.history.pushState({}, '', '/');
  vi.restoreAllMocks();
});

const RETURN_TO = '/api/v1/auth/login?return_to=%2Fmatters%2Fmat_falcon%2Fscope%3Ftab%3Dterms';

test('the sign-in URL comes back to a given path, escaped', () => {
  expect(loginUrl('/matters?stage=exported&x=1#top')).toBe('/api/v1/auth/login?return_to=%2Fmatters%3Fstage%3Dexported%26x%3D1%23top');
});

/** Whether the client has noted the session as ended (the flag the Shell shows), without subscribing to it. */
const ended = (client: QueryClient) => client.getQueryData(['session', 'ended']) === true;

test('a failed query with an ended session is noted for the app to show, and nothing navigates by itself', async () => {
  const client = makeQueryClient();
  await client.fetchQuery({ queryKey: ['x'], queryFn: () => Promise.reject(apiError('session_expired', 401)) }).catch(() => {});
  expect(ended(client)).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

test('so does a failed mutation', async () => {
  const client = makeQueryClient();
  await client.getMutationCache().build(client, { mutationFn: () => Promise.reject(apiError('session_expired', 401)) }).execute(undefined).catch(() => {});
  expect(ended(client)).toBe(true);
  expect(assign).not.toHaveBeenCalled();
});

test('other errors do not end the session', async () => {
  const client = makeQueryClient();
  for (const [code, status] of [['not_found', 404], ['conflict', 409], ['internal_error', 500], ['purview_permission_missing', 403]] as const) {
    await client.fetchQuery({ queryKey: [code], queryFn: () => Promise.reject(apiError(code, status)) }).catch(() => {});
  }
  await client.fetchQuery({ queryKey: ['network'], queryFn: () => Promise.reject(new TypeError('Failed to fetch')) }).catch(() => {});
  expect(ended(client)).toBe(false);
});

test('Sign in with the real API goes to its sign-in, back to the page the person was on', () => {
  signIn(makeQueryClient());
  expect(assign).toHaveBeenCalledExactlyOnceWith(RETURN_TO);
});

test('the page to come back to is always a path on this site', () => {
  window.history.pushState({}, '', `${window.location.origin}//elsewhere.example/x`);
  signIn(makeQueryClient());
  expect(assign).toHaveBeenCalledExactlyOnceWith('/api/v1/auth/login?return_to=%2Felsewhere.example%2Fx');
});

test('the whole app, when the session has ended: it says so in place of the page, with Sign in, and does not jump away', async () => {
  setScenario({ sessionExpired: true });
  renderApp('/matters');
  const heading = await screen.findByRole('heading', { level: 1, name: 'Your session has ended' });
  await vi.waitFor(() => expect(heading).toHaveFocus());
  expect(screen.getByRole('region', { name: 'Your session has ended' })).toHaveTextContent(
    "Sign in again with your Microsoft account to carry on. You'll come back to this page.",
  );
  // Said once: not as an alert as well (focus on the heading reads it), and not again by the page's own notices.
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.getAllByRole('heading', { name: /session has ended/, hidden: true })).toHaveLength(1);
  // The page itself is hidden, not shown half-loaded beside the notice.
  expect(screen.queryByRole('heading', { name: 'Matters' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Signed out')).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 100)); // let the other failing requests (/me, /matters) finish too
  expect(assign).not.toHaveBeenCalled();
  await expectNoA11yViolations(document.body);

  // With the real API, Sign in is a page load to its sign-in.
  await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
  expect(assign).toHaveBeenCalledExactlyOnceWith(RETURN_TO);
});

test('with the mocks, Sign in starts a new session in place: the page loads again where it was, with no page load', async () => {
  setSignInHere(() => setScenario({ sessionExpired: false })); // as mocks/browser.ts does
  setScenario({ sessionExpired: true });
  renderApp('/matters');
  await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Matters' })).toBeInTheDocument();
  expect(await screen.findByText('Project Falcon investigation')).toBeInTheDocument();
  expect(screen.queryByRole('heading', { name: 'Your session has ended' })).not.toBeInTheDocument();
  expect(within(screen.getByRole('navigation', { name: 'Main' })).getByText('Contoso Ltd')).toBeInTheDocument();
  // The notice that had focus has gone, so focus goes to the page's own heading.
  await vi.waitFor(() => expect(screen.getByRole('heading', { level: 1, name: 'Matters' })).toHaveFocus());
  expect(assign).not.toHaveBeenCalled();
});

test("inside the app, a screen's notice leaves an ended session to the Shell, then says the change wasn't made", async () => {
  setSignInHere(() => setScenario({ sessionExpired: false }));
  const client = makeQueryClient();
  const retry = vi.fn();
  render(
    <QueryClientProvider client={client}>
      <MemoryRouter>
        <ErrorNotice error={apiError('session_expired', 401)} onRetry={retry} />
      </MemoryRouter>
    </QueryClientProvider>,
  );
  client.setQueryData(['session', 'ended'], true);
  // While the session has ended, the Shell says so, once: the notice shows nothing.
  await vi.waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  expect(screen.queryByText(/session has ended/)).not.toBeInTheDocument();

  signIn(client);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: "That didn't go through" })).toBeInTheDocument();
  expect(alert).toHaveTextContent("Your session had ended, so nothing was changed. You're signed in again, so you can try it again.");
  expect(within(alert).queryByRole('link', { name: 'Sign in' })).not.toBeInTheDocument();
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(retry).toHaveBeenCalledTimes(1);
});

test('signing in again in place loads what had failed afresh, rather than keeping its "session ended" error', async () => {
  setSignInHere(() => setScenario({ sessionExpired: false }));
  setScenario({ sessionExpired: true });
  const client = makeQueryClient();
  await client.fetchQuery({ queryKey: ['me'], queryFn: () => Promise.reject(apiError('session_expired', 401)) }).catch(() => {});
  expect(client.getQueryState(['me'])?.status).toBe('error');
  signIn(client);
  // Not left in the error state while it loads again (nothing observes it here, so it waits for its next use).
  expect(client.getQueryState(['me'])).toMatchObject({ status: 'pending', error: null });
  expect(ended(client)).toBe(false);
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
