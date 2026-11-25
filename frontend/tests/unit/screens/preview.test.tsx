import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { pollDelay } from '@/api/jobs';
import { example } from '@/mocks/examples';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { jobPolling } from '@/screens/preview/hooks';
import { monthSpan, showingText, sizeText, toItemFilter } from '@/screens/preview/format';
import { expectNoA11yViolations } from '../a11y';
import { FALCON, FALCON_PREVIEW, post, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

const PATH = `/matters/${FALCON}/preview`;
const falcon = () => example<Schemas['Matter']>('getMatter', '200');
const answerMatter = (matter: Schemas['Matter']) => server.use(http.get('/api/v1/matters/:matterId', () => HttpResponse.json(matter)));
const noPreviewYet = (options: { once?: boolean } = {}) =>
  server.use(
    http.get('/api/v1/matters/:matterId/previews/latest', () => HttpResponse.json({ code: 'not_found', message: 'No preview for this matter yet with that ID.', details: {} }, { status: 404 }), options),
  );

/** The item requests the screen makes, as their query strings. */
function watchItemRequests() {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/items')) seen.push(url.searchParams);
  });
  return seen;
}

const loaded = async () => screen.findByText(/^Showing 1–10 of 655$/);

beforeEach(() => {
  jobPolling.pollMs = () => 20; // the job follows the mock clock, which tick() moves; poll often so the screen sees it
});
afterEach(() => {
  jobPolling.pollMs = pollDelay;
});

test('shows the latest preview: where it came from, the count tiles, breakdowns, months and the first page of items', async () => {
  renderApp(PATH);
  await loaded();
  expect(screen.getByRole('heading', { level: 2, name: 'Preview' })).toBeInTheDocument();
  expect(screen.getByText(/Built from Purview's item report for/)).toHaveTextContent(/query v3, .* It lists metadata only/);

  const tile = (label: string) => screen.getByText(label, { selector: 'dt' }).parentElement!;
  expect(tile('Items matching')).toHaveTextContent('63029.0 MB');
  expect(tile('Partially indexed')).toHaveTextContent('2521.7 MB · included in this preview');
  expect(tile('Encrypted')).toHaveTextContent('41Reviewers may not be able to open these');
  expect(tile('Locations')).toHaveTextContent('62 mailboxes, 4 OneDrive and SharePoint sites');

  expect(screen.getByRole('heading', { level: 2, name: "What's in the 655 items" })).toBeInTheDocument();
  expect(screen.getByText(/Includes the 25 partially indexed items/)).toBeInTheDocument();
  for (const title of ['By custodian or site', 'By type', 'By sensitivity label']) {
    expect(screen.getByRole('heading', { level: 3, name: title })).toBeInTheDocument();
  }
  expect(screen.getByRole('button', { name: /^Teams chat\s*223$/ })).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('heading', { level: 2, name: 'By month' })).toBeInTheDocument();
  expect(screen.getByText('Jan 2024 to Jun 2025')).toBeInTheDocument();
  expect(screen.getByRole('img', { name: /Lowest 28 in January 2025, highest 50 in September 2024/ })).toBeInTheDocument();

  const table = screen.getByRole('table', { name: 'Items' });
  expect(within(table).getAllByRole('row')).toHaveLength(11); // the header and 10 items
  expect(within(table).getAllByRole('columnheader').map((h) => h.textContent)).toEqual(['Item', 'Location', 'Type', 'Date', 'Sensitivity label', 'Size']);
  expect(screen.getByText('The full list of 655 items is in preview.csv.')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Continue to export' })).toHaveAttribute('href', `/matters/${FALCON}/export`);
  await expectNoA11yViolations(document.body);
});

test('choosing a bar filters the item table, and choosing it again or the chip clears the filter', async () => {
  const requests = watchItemRequests();
  renderApp(PATH);
  await loaded();

  await userEvent.click(screen.getByRole('button', { name: /^Teams chat\s*223$/ }));
  expect(await screen.findByText('Showing 1–10 of the 223 where the type is Teams chat')).toBeInTheDocument();
  expect(requests.at(-1)?.get('type')).toBe('teams_chat');
  expect(screen.getByRole('button', { name: /^Teams chat\s*223$/ })).toHaveAttribute('aria-pressed', 'true');
  const table = screen.getByRole('table', { name: 'Items where type is Teams chat' });
  expect(within(table).getAllByRole('cell', { name: 'Teams chat' })).toHaveLength(10);

  // Another bar replaces the filter: one at a time, as on the design.
  await userEvent.click(screen.getByRole('button', { name: /^No label\s*119$/ }));
  expect(await screen.findByText('Showing 1–10 of the 119 where the label is No label')).toBeInTheDocument();
  expect(requests.at(-1)?.get('label')).toBe('No label');
  expect(requests.at(-1)?.has('type')).toBe(false);
  expect(screen.getByRole('button', { name: /^Teams chat\s*223$/ })).toHaveAttribute('aria-pressed', 'false');

  await userEvent.click(screen.getByRole('button', { name: 'Clear filter: No label' }));
  await loaded();
  expect(screen.queryByRole('button', { name: /^Clear filter/ })).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: /^sites\/Finance\s*62$/ }));
  expect(await screen.findByText('Showing 1–10 of the 62 where the location is sites/Finance')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: /^sites\/Finance\s*62$/ }));
  await loaded();
});

test('the item table pages through the items, and a filter starts again on page 1', async () => {
  const requests = watchItemRequests();
  renderApp(PATH);
  await loaded();
  const pages = screen.getByRole('navigation', { name: 'Item pages' });
  expect(within(pages).getByText('Page 1 of 66')).toBeInTheDocument();
  expect(within(pages).getByRole('button', { name: 'Previous' })).toBeDisabled();

  await userEvent.click(within(pages).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Showing 11–20 of 655')).toBeInTheDocument();
  expect(requests.at(-1)?.get('page')).toBe('2');
  expect(requests.at(-1)?.get('page_size')).toBe('10');
  expect(within(pages).getByRole('button', { name: 'Previous' })).toBeEnabled();

  await userEvent.click(screen.getByRole('button', { name: /^Email\s*223$/ }));
  expect(await screen.findByText('Showing 1–10 of the 223 where the type is Email')).toBeInTheDocument();
  expect(requests.at(-1)?.get('page')).toBe('1');
  expect(screen.getByText('Page 1 of 23')).toBeInTheDocument();
});

test('the whole list downloads as a plain link to items.csv', async () => {
  renderApp(PATH);
  await loaded();
  const link = screen.getByRole('link', { name: 'Download preview.csv' });
  expect(link).toHaveAttribute('href', expect.stringMatching(new RegExp(`/api/v1/previews/${FALCON_PREVIEW}/items\\.csv$`)));
  expect(link).toHaveAttribute('download');
});

test('refreshing starts a preview job: its progress shows while it runs, and the new preview replaces the old one', async () => {
  const requests = watchItemRequests();
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));

  const bar = await screen.findByRole('progressbar', { name: 'Previewing query v3' });
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeDisabled();
  tick(4.5);
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
  expect(screen.getByText(/^50% · Purview is building the item report/)).toBeInTheDocument();
  // The old preview stays on screen while the new one is built.
  expect(screen.getByRole('heading', { name: "What's in the 655 items" })).toBeInTheDocument();

  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  await waitFor(() => expect(requests.some((q, i) => i > 0 && q.get('page') === '1')).toBe(true));
  await waitFor(() => expect(screen.getByRole('link', { name: 'Download preview.csv' }).getAttribute('href')).not.toContain(FALCON_PREVIEW));
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeEnabled();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('a preview job that is already running is picked up when the screen opens', async () => {
  await post(`/matters/${FALCON}/previews`);
  tick(3);
  renderApp(PATH);
  const bar = await screen.findByRole('progressbar', { name: 'Previewing query v3' });
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '33'));
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeDisabled();
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
});

test("starting while another preview runs follows that one instead of showing an error", async () => {
  const running = (await post(`/matters/${FALCON}/previews`)).json as Schemas['Job'];
  // The screen hasn't noticed it (as if it started a moment after the screen asked).
  server.use(http.get('/api/v1/matters/:matterId/jobs', () => HttpResponse.json({ items: [] })));
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(running.kind).toBe('preview');
});

test('a preview job that fails says why, keeps the last preview, and can be tried again', async () => {
  setScenario({ failJobs: ['preview'] });
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByRole('progressbar');
  tick(10);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: "Purview couldn't finish that" })).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('Showing 1–10 of 655')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  setScenario({ failJobs: [] });
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('with nothing previewed yet, the screen offers to preview the current query, then shows the result', async () => {
  noPreviewYet({ once: true });
  renderApp(PATH);
  expect(await screen.findByText('Nothing previewed yet')).toBeInTheDocument();
  expect(screen.queryByRole('table')).not.toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  await userEvent.click(screen.getByRole('button', { name: 'Preview query v3' }));
  expect(await screen.findByRole('progressbar', { name: 'Previewing query v3' })).toBeInTheDocument();
  expect(screen.queryByText('Nothing previewed yet')).not.toBeInTheDocument();
  tick(10);
  await loaded();
  expect(screen.queryByText('Nothing previewed yet')).not.toBeInTheDocument();
});

test('with no query yet, the screen sends the person to Scope', async () => {
  noPreviewYet();
  answerMatter({ ...falcon(), current_version: null, previewed_version: null, last_previewed_at: null, stage: 'scoping' });
  renderApp(PATH);
  expect(await screen.findByText('Nothing previewed yet')).toBeInTheDocument();
  expect(screen.getByText(/Build and estimate a query on Scope first/)).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to Scope' })).toHaveAttribute('href', `/matters/${FALCON}/scope`);
  expect(screen.queryByRole('button', { name: /^Preview query/ })).not.toBeInTheDocument();
});

test("starting a preview the API refuses shows the API's reason", async () => {
  // Harlow has a query that was never estimated: the mock refuses, as the API would.
  renderApp('/matters/mat_harlow/preview');
  await userEvent.click(await screen.findByRole('button', { name: 'Preview query v1' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Estimate the query first.');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('when the draft changed after the preview, a banner says so and points to Scope', async () => {
  answerMatter({ ...falcon(), draft_changed: true });
  renderApp(PATH);
  await loaded();
  const banner = screen.getByText('The search has changed since this preview.').closest('[role="status"]') as HTMLElement;
  expect(banner).toHaveTextContent('This preview is of query v3. Estimate the changes on Scope, then preview again before you export.');
  expect(within(banner).getByRole('link', { name: 'Go to Scope' })).toHaveAttribute('href', `/matters/${FALCON}/scope`);
});

test('when a newer query version has not been previewed, a banner offers to preview it', async () => {
  answerMatter({ ...falcon(), current_version: 4 });
  renderApp(PATH);
  await loaded();
  const banner = screen.getByText("Query v4 hasn't been previewed.").closest('[role="status"]') as HTMLElement;
  expect(banner).toHaveTextContent('This preview is of query v3. Preview again before you export');
  expect(within(banner).getByRole('button', { name: 'Preview query v4' })).toBeEnabled();
});

test('a preview the API marks stale gets a banner too', async () => {
  const preview = example<Schemas['Preview']>('getLatestPreview', '200');
  server.use(http.get('/api/v1/matters/:matterId/previews/latest', () => HttpResponse.json({ ...preview, stale: true })));
  renderApp(PATH);
  await loaded();
  const banner = screen.getByText('This preview is out of date.').closest('[role="status"]') as HTMLElement;
  expect(within(banner).getByRole('button', { name: 'Preview again' })).toBeInTheDocument();
});

test('a current preview has no stale banner', async () => {
  renderApp(PATH);
  await loaded();
  expect(screen.queryByText(/hasn't been previewed|has changed since this preview|out of date/)).not.toBeInTheDocument();
});

test('when the preview cannot be loaded, the error says so and offers to try again', async () => {
  server.use(http.get('/api/v1/matters/:matterId/previews/latest', () => HttpResponse.json({ code: 'internal_error', message: 'The database is busy.', details: {} }, { status: 500 })));
  renderApp(PATH);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The database is busy.');
  expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('when a page of items cannot be loaded, the table says so and the rest of the preview stays', async () => {
  server.use(http.get('/api/v1/previews/:previewId/items', () => HttpResponse.json({ code: 'internal_error', message: 'Items are unavailable.', details: {} }, { status: 500 })));
  renderApp(PATH);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Items are unavailable.');
  expect(screen.getByRole('heading', { name: "What's in the 655 items" })).toBeInTheDocument();
});

describe('formatting', () => {
  test('sizes in KB, MB and GB', () => {
    expect([49152, 1258291, 30408704, 3072, 512, null, 5 * 1024 ** 3].map(sizeText)).toEqual(['48 KB', '1.2 MB', '29.0 MB', '3 KB', '512 B', '', '5.0 GB']);
  });
  test("a bar becomes the item table's filter", () => {
    expect(toItemFilter(null)).toEqual({});
    expect(toItemFilter({ dimension: 'type', name: 'Teams chat', count: 1 })).toEqual({ type: 'teams_chat' });
    expect(toItemFilter({ dimension: 'type', name: 'Calendar', count: 1 })).toEqual({ type: 'other' });
    expect(toItemFilter({ dimension: 'label', name: 'No label', count: 1 })).toEqual({ label: 'No label' });
    expect(toItemFilter({ dimension: 'location', name: 'Alex Wilber', count: 1 })).toEqual({ location: 'Alex Wilber' });
  });
  test('what the table is showing', () => {
    const page = { items: [{}, {}] as Schemas['PreviewItem'][], total: 12, page: 2, page_size: 10 };
    expect(showingText(page, null)).toBe('Showing 11–12 of 12');
    expect(showingText(page, { dimension: 'location', name: 'Alex Wilber', count: 12 })).toBe('Showing 11–12 of the 12 where the location is Alex Wilber');
    expect(showingText({ items: [], total: 0, page: 1, page_size: 10 }, null)).toBe('No items');
    expect(monthSpan([{ month: '2024-01' }, { month: '2025-06' }])).toBe('Jan 2024 to Jun 2025');
    expect(monthSpan([])).toBeUndefined();
  });
});
