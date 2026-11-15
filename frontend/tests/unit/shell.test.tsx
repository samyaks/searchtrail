import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { example } from '@/mocks/examples';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from './a11y';
import { renderApp } from './renderApp';

const me = (changes: Partial<Schemas['Me']> = {}) => ({ ...example<Schemas['Me']>('getMe', '200'), ...changes });
const answerMe = (body: unknown, status = 200) => server.use(http.get('/api/v1/me', () => HttpResponse.json(body as object, { status })));
const mainNav = async () => screen.findByRole('navigation', { name: 'Main' });

test('the shell shows the tenant, the way in to Matters, and who is signed in', async () => {
  renderApp('/matters');
  const nav = await mainNav();
  expect(await within(nav).findByText('Contoso Ltd')).toBeInTheDocument();
  expect(within(nav).getByText('Dry run (no tenant contacted)')).toBeInTheDocument();
  expect(within(nav).getByRole('link', { name: 'SearchTrail' })).toHaveAttribute('href', '/matters');
  expect(within(nav).getByRole('link', { name: 'Matters' })).toHaveAttribute('aria-current', 'page');
  expect(within(nav).getByText('Dana Whitfield')).toBeInTheDocument();
  expect(within(nav).getByText('eDiscovery Manager')).toBeInTheDocument();
  expect(within(nav).getByText('DW')).toBeInTheDocument();
});

test('Matters stays marked while one of its matters is open', async () => {
  renderApp('/matters/mat_falcon/define');
  const nav = await mainNav();
  expect(within(nav).getByRole('link', { name: 'Matters' })).toHaveAttribute('aria-current', 'page');
});

test('a live tenant is shown as connected, and a government cloud is named', async () => {
  answerMe(me({ dry_run: false, cloud: 'gcc_high' }));
  renderApp('/matters');
  const nav = await mainNav();
  expect(await within(nav).findByText('Microsoft 365 connected')).toBeInTheDocument();
  expect(within(nav).getByText('Microsoft 365 GCC High')).toBeInTheDocument();
  expect(within(nav).queryByText(/Dry run/)).not.toBeInTheDocument();
});

test('a person with no Purview role is told so, rather than shown nothing', async () => {
  answerMe(me({ purview_roles: [] }));
  renderApp('/matters');
  expect(await within(await mainNav()).findByText('No Purview role found')).toBeInTheDocument();
});

test('while the connection is checked, and if it cannot be', async () => {
  renderApp('/matters');
  expect(within(await mainNav()).getByText('Connecting…')).toBeInTheDocument();
  expect(await within(await mainNav()).findByText('Contoso Ltd')).toBeInTheDocument();
});

test('when SearchTrail\'s server does not answer, the card says "Not connected" and the page still opens', async () => {
  answerMe({ code: 'internal_error', message: 'Something went wrong.', details: {} }, 500);
  renderApp('/matters');
  expect(await within(await mainNav()).findByText('Not connected')).toBeInTheDocument();
  expect(await screen.findByRole('table', { name: 'Matters' })).toBeInTheDocument();
  expect(within(await mainNav()).queryByText('Dana Whitfield')).not.toBeInTheDocument();
});

test('the first Tab stop skips the navigation and lands on the page', async () => {
  renderApp('/matters');
  await screen.findByRole('table', { name: 'Matters' });
  await userEvent.tab();
  const skip = screen.getByRole('link', { name: 'Skip to the page' });
  expect(skip).toHaveFocus();
  expect(skip).toHaveAttribute('href', '#main');
  expect(screen.getByRole('main')).toHaveAttribute('id', 'main');
});

test('the shell has the landmarks a screen reader needs, and no accessibility violations', async () => {
  renderApp('/matters/mat_falcon/define');
  await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' });
  expect(screen.getByRole('navigation', { name: 'Main' })).toBeInTheDocument();
  expect(screen.getByRole('main')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);
});
