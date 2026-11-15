import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { MATTER_TABS } from '@/app/tabs';
import type { Schemas } from '@/api/client';
import { example } from '@/mocks/examples';
import { server } from '@/mocks/server';
import { expectNoA11yViolations } from './a11y';
import { renderApp } from './renderApp';

const falcon = () => example<Schemas['Matter']>('getMatter', '200');
const answerMatter = (matter: Schemas['Matter']) => server.use(http.get('/api/v1/matters/:matterId', () => HttpResponse.json(matter)));

test("the header names the matter and says what's in it", async () => {
  renderApp('/matters/mat_falcon/define');
  const heading = await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' });
  const header = heading.closest('header')!;
  expect(within(within(header).getByRole('navigation', { name: 'Breadcrumb' })).getByRole('link', { name: 'Matters' })).toHaveAttribute('href', '/matters');
  expect(within(header).getByText('M-2026-0142')).toBeInTheDocument();
  expect(within(header).getByText(/^Purview case M-2026-0142 · 2 custodians · 2 SharePoint sites · opened \d+ \w+ 2026$/)).toBeInTheDocument();
});

test('the chips say which query version this is and whether it was previewed', async () => {
  renderApp('/matters/mat_falcon/define');
  await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' });
  expect(screen.getByText('Query v3')).toBeInTheDocument();
  expect(screen.getByText(/^Previewed /)).toBeInTheDocument();
});

test('a matter with a changed draft says the draft is the next version, and not previewed', async () => {
  answerMatter({ ...falcon(), draft_changed: true });
  renderApp('/matters/mat_falcon/define');
  expect(await screen.findByText('Query v4 · draft')).toBeInTheDocument();
  expect(screen.getByText('Not previewed yet')).toBeInTheDocument();
});

test('a new matter has no query and no Purview case yet', async () => {
  answerMatter({ ...falcon(), current_version: null, previewed_version: null, last_previewed_at: null, purview_case_id: null, stage: 'scoping' });
  renderApp('/matters/mat_falcon/define');
  expect(await screen.findByText('No query yet')).toBeInTheDocument();
  expect(screen.getByText(/^No Purview case yet · /)).toBeInTheDocument();
});

test.each(MATTER_TABS)('the $label tab is marked when it is open, and the others are not', async ({ path, label }) => {
  renderApp(`/matters/mat_falcon/${path}`);
  const tabs = within(await screen.findByRole('navigation', { name: 'Matter sections' }));
  expect(tabs.getAllByRole('link').map((link) => link.textContent)).toEqual(MATTER_TABS.map((tab) => tab.label));
  expect(tabs.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
  expect(tabs.getAllByRole('link').filter((link) => link.hasAttribute('aria-current'))).toHaveLength(1);
});

test('choosing a tab opens that screen', async () => {
  const router = renderApp('/matters/mat_falcon/define');
  await userEvent.click(await screen.findByRole('link', { name: 'Preview' }));
  expect(router.state.location.pathname).toBe('/matters/mat_falcon/preview');
  expect(await screen.findByRole('heading', { level: 2, name: 'Preview' })).toBeInTheDocument();
});

test('while the matter loads there is a heading and no chips', async () => {
  server.use(
    http.get('/api/v1/matters/:matterId', async () => {
      await delay(200);
      return HttpResponse.json(falcon());
    }),
  );
  renderApp('/matters/mat_falcon/define');
  const heading = screen.getByRole('heading', { level: 1, name: 'Loading…' });
  expect(heading.closest('header')).toHaveAttribute('aria-busy', 'true');
  expect(screen.queryByText(/^Query v/)).not.toBeInTheDocument();
  expect(await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 1 }).closest('header')).toHaveAttribute('aria-busy', 'false');
});

test('a matter that is not there is a page of its own, with the way back and no tabs', async () => {
  renderApp('/matters/mat_nope/scope');
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 1, name: "We can't find that" })).toBeInTheDocument();
  expect(within(alert).getByRole('link', { name: 'Back to Matters' })).toHaveAttribute('href', '/matters');
  expect(screen.queryByRole('navigation', { name: 'Matter sections' })).not.toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 2, name: 'Scope' })).not.toBeInTheDocument();
});

test('when the server fails, the page offers to try again, and then shows the matter', async () => {
  server.use(
    http.get('/api/v1/matters/:matterId', () => HttpResponse.json({ code: 'internal_error', message: 'Something went wrong on our side.', details: {} }, { status: 500 }), { once: true }),
  );
  renderApp('/matters/mat_falcon/define');
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByText('Something went wrong on our side.')).toBeInTheDocument();
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('the header and tabs have no accessibility violations', async () => {
  renderApp('/matters/mat_falcon/define');
  await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' });
  await expectNoA11yViolations(document.body);
});
