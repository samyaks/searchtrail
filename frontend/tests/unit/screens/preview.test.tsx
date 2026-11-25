import { act, screen, waitFor, within } from '@testing-library/react';
import { onlineManager } from '@tanstack/react-query';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { pollDelay } from '@/api/jobs';
import { example } from '@/mocks/examples';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { fileNameOf, jobPolling } from '@/screens/preview/hooks';
import { captionText, madeWhen, monthSpan, showingText, sizeText, toItemFilter } from '@/screens/preview/format';
import { expectNoA11yViolations } from '../a11y';
import { FALCON, FALCON_PREVIEW, get, post, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

const PATH = `/matters/${FALCON}/preview`;
const falcon = () => example<Schemas['Matter']>('getMatter', '200');
const answerMatter = (matter: Schemas['Matter']) => server.use(http.get('/api/v1/matters/:matterId', () => HttpResponse.json(matter)));
const noPreviewYet = (options: { once?: boolean } = {}) =>
  server.use(
    http.get('/api/v1/matters/:matterId/previews/latest', () => HttpResponse.json({ code: 'not_found', message: 'No preview for this matter yet with that ID.', details: {} }, { status: 404 }), options),
  );

/** The requests the screen makes whose path matches, as URLs. */
function watchRequests(path: RegExp) {
  const seen: URL[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (path.test(url.pathname)) seen.push(url);
  });
  return seen;
}

/** The item requests the screen makes: their query strings, and their paths. */
function watchItemRequests() {
  const urls = watchRequests(/\/items$/);
  return {
    at: (i: number) => urls.at(i)?.searchParams,
    paths: () => urls.map((url) => url.pathname),
  };
}

/** Hold the answers to requests until release() is called. */
function gate() {
  let release!: () => void;
  const opened = new Promise<void>((resolve) => (release = resolve));
  return { opened, release };
}

const loaded = async () => screen.findByText(/^Showing 1–10 of 655$/);

beforeEach(() => {
  jobPolling.pollMs = () => 20; // the job follows the mock clock, which tick() moves; poll often so the screen sees it
});
afterEach(() => {
  jobPolling.pollMs = pollDelay;
  onlineManager.setOnline(true);
  server.events.removeAllListeners();
  vi.restoreAllMocks();
});

test('shows the latest preview: where it came from, the count tiles, breakdowns, months and the first page of items', async () => {
  renderApp(PATH);
  await loaded();
  expect(screen.getByRole('heading', { level: 2, name: 'Preview' })).toBeInTheDocument();
  expect(screen.getByText(/Built from Purview's item report for/)).toHaveTextContent(
    /^Built from Purview's item report for search M-2026-0142 cull v3 (at \d\d:\d\d|yesterday at \d\d:\d\d|on \d{1,2} \w{3}( \d{4})?)\. It lists metadata only; document contents stay in Purview until export\.$/,
  );

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
  const table = screen.getByRole('table', { name: 'Items where the type is Teams chat' });
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
  // The chip has gone: the focus moves to the table's heading, not to the page.
  expect(screen.getByRole('heading', { level: 2, name: 'Items' })).toHaveFocus();

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
  // Unavailable, but still focusable: a disabled button would drop the focus.
  expect(within(pages).getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(within(pages).getByRole('button', { name: 'Previous' }));
  expect(within(pages).getByText('Page 1 of 66')).toBeInTheDocument();

  await userEvent.click(within(pages).getByRole('button', { name: 'Next' }));
  expect(await screen.findByText('Showing 11–20 of 655')).toBeInTheDocument();
  expect(requests.at(-1)?.get('page')).toBe('2');
  expect(requests.at(-1)?.get('page_size')).toBe('10');
  expect(within(pages).getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'false');

  await userEvent.click(screen.getByRole('button', { name: /^Email\s*223$/ }));
  expect(await screen.findByText('Showing 1–10 of the 223 where the type is Email')).toBeInTheDocument();
  expect(requests.at(-1)?.get('page')).toBe('1');
  expect(screen.getByText('Page 1 of 23')).toBeInTheDocument();
});

/** Catch the file the screen saves: the blob it links to and the name it gives it. */
function catchDownloads() {
  const saved: { blob: Blob; name: string }[] = [];
  const blobs = new Map<string, Blob>();
  const revoked: string[] = [];
  let next = 0;
  // jsdom has no object URLs, and a click on a link would try to navigate.
  vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    const url = `blob:test/${(next += 1)}`;
    blobs.set(url, blob as Blob);
    return url;
  });
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation((url) => void revoked.push(url));
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved.push({ blob: blobs.get(this.href)!, name: this.download });
  });
  return { saved, revoked };
}

test('the whole list downloads through the API (so the mocks and the session work), under the name the API gives it', async () => {
  const csv = watchRequests(/\/items\.csv$/);
  const downloads = catchDownloads();
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Download preview.csv' }));

  await waitFor(() => expect(downloads.saved).toHaveLength(1));
  expect(csv.map((url) => url.pathname)).toEqual([`/api/v1/previews/${FALCON_PREVIEW}/items.csv`]);
  expect(downloads.saved[0]!.name).toBe('M-2026-0142-preview.csv');
  expect(await downloads.saved[0]!.blob.text()).toMatch(/^item_id,location,item_type,subject/);
  // The object URL is let go of a moment later, not before the browser has read it.
  expect(downloads.revoked).toEqual([]);
  await waitFor(() => expect(downloads.revoked).toEqual(['blob:test/1']), { timeout: 2_000 });
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('while the file downloads, the button says so and does nothing more', async () => {
  const hold = gate();
  const csv = watchRequests(/\/items\.csv$/);
  const downloads = catchDownloads();
  server.use(
    http.get('/api/v1/previews/:previewId/items.csv', async () => {
      await hold.opened;
      return undefined; // on to the stateful mock
    }),
  );
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Download preview.csv' }));
  const busy = await screen.findByRole('button', { name: 'Downloading…' });
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(busy);
  expect(csv).toHaveLength(1);

  hold.release();
  expect(await screen.findByRole('button', { name: 'Download preview.csv' })).toBeInTheDocument();
  expect(downloads.saved).toHaveLength(1);
});

test('a download the API refuses says why, and nothing is saved', async () => {
  const downloads = catchDownloads();
  server.use(http.get('/api/v1/previews/:previewId/items.csv', () => HttpResponse.json({ code: 'not_found', message: 'That preview has gone.', details: {} }, { status: 404 })));
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Download preview.csv' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('That preview has gone.');
  expect(downloads.saved).toEqual([]);
});

test('while another filter loads, the table does not describe the old rows as the new filter', async () => {
  const hold = gate();
  server.use(
    http.get('/api/v1/previews/:previewId/items', async ({ request }) => {
      if (new URL(request.url).searchParams.has('type')) await hold.opened;
      return undefined; // on to the stateful mock
    }),
  );
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: /^Teams chat\s*223$/ }));

  // The first page's rows are still on screen, but the status and the caption don't claim they are Teams chats.
  expect(await screen.findByText('Loading items…', { selector: '[role="status"]' })).toBeInTheDocument();
  expect(screen.queryByText(/^Showing/)).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Items' })).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: /where/ })).not.toBeInTheDocument();
  // Nor does the pager page on the old total, or show it.
  const pages = screen.getByRole('navigation', { name: 'Item pages' });
  expect(within(pages).getByText('Page 1')).toBeInTheDocument();
  expect(within(pages).queryByText(/of 66/)).not.toBeInTheDocument();
  expect(within(pages).getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'true');
  expect(within(pages).getByRole('button', { name: 'Previous' })).toHaveAttribute('aria-disabled', 'true');

  hold.release();
  expect(await screen.findByText('Showing 1–10 of the 223 where the type is Teams chat')).toBeInTheDocument();
  expect(screen.getByRole('table', { name: 'Items where the type is Teams chat' })).toBeInTheDocument();
  expect(within(pages).getByText('Page 1 of 23')).toBeInTheDocument();
  expect(within(pages).getByRole('button', { name: 'Next' })).toHaveAttribute('aria-disabled', 'false');
});

test('on the last page, Next stays focusable and does nothing', async () => {
  const firstPage = example<Schemas['PreviewItemPage']>('listPreviewItems', '200');
  server.use(
    http.get('/api/v1/previews/:previewId/items', ({ request }) => {
      const page = Number(new URL(request.url).searchParams.get('page') ?? '1');
      const items = firstPage.items.map((item) => ({ ...item, id: `${item.id}-p${page}` }));
      return HttpResponse.json({ ...firstPage, items, total: 20, page });
    }),
  );
  renderApp(PATH);
  await screen.findByText('Showing 1–10 of 20');
  const pages = screen.getByRole('navigation', { name: 'Item pages' });
  const next = within(pages).getByRole('button', { name: 'Next' });
  await userEvent.click(next);
  expect(await screen.findByText('Showing 11–20 of 20')).toBeInTheDocument();
  expect(next).toHaveFocus();
  expect(next).toHaveAttribute('aria-disabled', 'true');
  await userEvent.click(next);
  expect(within(pages).getByText('Page 2 of 2')).toBeInTheDocument();
  expect(next).toHaveFocus();
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
  const newest = (await get(`/matters/${FALCON}/previews/latest`)).json as Schemas['Preview'];
  expect(newest.id).not.toBe(FALCON_PREVIEW);
  // The table now shows the new preview's items, from page 1.
  await waitFor(() => expect(requests.paths()).toContain(`/api/v1/previews/${newest.id}/items`));
  expect(requests.at(-1)?.get('page')).toBe('1');
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
  expect(running.kind).toBe('preview');
  // The screen hasn't noticed it (as if it started a moment after the screen asked).
  server.use(http.get('/api/v1/matters/:matterId/jobs', () => HttpResponse.json({ items: [] })));
  const jobRequests = watchRequests(/^\/api\/v1\/jobs\//);
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  // It is the running job (named by the API's 409) that the screen follows.
  expect(jobRequests.map((url) => url.pathname)).toContain(`/api/v1/jobs/${running.id}`);
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
});

test('when asking about the job is refused, the screen says so instead of going quiet', async () => {
  await post(`/matters/${FALCON}/previews`);
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'not_found', message: 'That job has gone.', details: {} }, { status: 404 })));
  renderApp(PATH);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent("We can't find the preview job. That job has gone.");
  // A job that's gone doesn't send the person away from a screen that still works: it offers to preview again.
  expect(within(alert).queryByRole('link', { name: 'Back to Matters' })).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  // The last preview is still there.
  await loaded();

  // (The mock's job ends, so the new preview is a new job, as it would be for a job that was cleared away.)
  tick(10);
  server.resetHandlers();
  await userEvent.click(within(alert).getByRole('button', { name: 'Preview again' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('other refusals to say how the job is going keep the shared notice', async () => {
  await post(`/matters/${FALCON}/previews`);
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'purview_permission_missing', message: 'You need the eDiscovery Manager role.', details: {} }, { status: 403 })));
  renderApp(PATH);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: 'You need a Purview permission for this' })).toBeInTheDocument();
  expect(alert).toHaveTextContent('You need the eDiscovery Manager role.');
});

test('a job that already succeeded shows no error when a later look at it fails', async () => {
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  await screen.findByText(/^Showing 1–10 of/);

  // The job is asked about again (here after a moment offline) and the server fails.
  const jobRequests = watchRequests(/^\/api\/v1\/jobs\//);
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'internal_error', message: 'Down for a moment.', details: {} }, { status: 500 })));
  act(() => onlineManager.setOnline(false));
  act(() => onlineManager.setOnline(true));
  await waitFor(() => expect(jobRequests.length).toBeGreaterThan(0));
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByText('Down for a moment.')).not.toBeInTheDocument();
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
  // The failure names the preview, not another kind of job.
  expect(alert).toHaveTextContent('Purview stopped the preview: the search could not be found.');
  expect(alert).not.toHaveTextContent('export');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(screen.getByText('Showing 1–10 of 655')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  // One button to try again: the page's own, not a second one in the notice that does the same thing.
  expect(within(alert).queryByRole('button')).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^(Try again|Preview query|Refresh preview|Preview again)/ })).toHaveLength(1);

  setScenario({ failJobs: [] });
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
});

test('a failed preview of a newer query version offers one button to preview it, not a second "Try again"', async () => {
  setScenario({ failJobs: ['preview'] });
  answerMatter({ ...falcon(), current_version: 4 });
  renderApp(PATH);
  await loaded();
  await userEvent.click(screen.getByRole('button', { name: 'Preview query v4' }));
  await screen.findByRole('progressbar');
  tick(10);
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: "Purview couldn't finish that" })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^(Try again|Preview query|Refresh preview|Preview again)/ }).map((b) => b.textContent)).toEqual(['Preview query v4']);
});

test('a failed first preview offers one button to preview the query', async () => {
  setScenario({ failJobs: ['preview'] });
  noPreviewYet();
  renderApp(PATH);
  await userEvent.click(await screen.findByRole('button', { name: 'Preview query v3' }));
  await screen.findByRole('progressbar');
  tick(10);
  await screen.findByRole('alert');
  expect(await screen.findByText('Nothing previewed yet')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: /^(Try again|Preview query|Refresh preview|Preview again)/ }).map((b) => b.textContent)).toEqual(['Preview query v3']);
});

test("when a new preview finishes, the old preview's items are not asked for again", async () => {
  const requests = watchItemRequests();
  renderApp(PATH);
  await loaded();
  expect(requests.paths()).toEqual([`/api/v1/previews/${FALCON_PREVIEW}/items`]);
  await userEvent.click(screen.getByRole('button', { name: 'Refresh preview' }));
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  const newest = (await get(`/matters/${FALCON}/previews/latest`)).json as Schemas['Preview'];
  // Once the new preview's items have been asked for, any refetch of the old one's (set off when the job ended,
  // before the new preview was even read) would have been asked for already.
  await waitFor(() => expect(requests.paths()).toContain(`/api/v1/previews/${newest.id}/items`));
  expect(requests.paths()).toEqual([`/api/v1/previews/${FALCON_PREVIEW}/items`, `/api/v1/previews/${newest.id}/items`]);
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

test('with nothing previewed yet, the screen waits for the matter before it says what to do', async () => {
  noPreviewYet();
  const hold = gate();
  const matter = falcon();
  server.use(
    http.get('/api/v1/matters/:matterId', async () => {
      await hold.opened;
      return HttpResponse.json(matter);
    }),
  );
  const latest = watchRequests(/\/previews\/latest$/);
  renderApp(PATH);
  await waitFor(() => expect(latest).toHaveLength(1));
  expect(await screen.findByText('Loading the preview…')).toBeInTheDocument();
  // Without the matter, its query version is unknown: don't send the person to Scope meanwhile.
  expect(screen.queryByText('Nothing previewed yet')).not.toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Go to Scope' })).not.toBeInTheDocument();

  hold.release();
  expect(await screen.findByRole('button', { name: 'Preview query v3' })).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: 'Go to Scope' })).not.toBeInTheDocument();
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
  // The toolbar can still preview query v3 again, and says so.
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: /^Preview query/ })).not.toBeInTheDocument();
});

test('when the draft changed and a newer version was estimated, the toolbar names the version it would preview', async () => {
  answerMatter({ ...falcon(), draft_changed: true, current_version: 4 });
  renderApp(PATH);
  await loaded();
  expect(screen.getByRole('button', { name: 'Preview query v4' })).toBeEnabled();
  expect(screen.queryByRole('button', { name: 'Refresh preview' })).not.toBeInTheDocument();
});

test('when a newer query version has not been previewed, a banner offers to preview it', async () => {
  answerMatter({ ...falcon(), current_version: 4 });
  renderApp(PATH);
  await loaded();
  const banner = screen.getByText("Query v4 hasn't been previewed.").closest('[role="status"]') as HTMLElement;
  expect(banner).toHaveTextContent('This preview is of query v3. Preview again before you export');
  expect(within(banner).getByRole('button', { name: 'Preview query v4' })).toBeEnabled();
  // One button to start a preview: the banner's. The toolbar's would do the same thing under another name.
  expect(screen.getAllByRole('button', { name: /^(Preview query|Refresh preview|Preview again)/ })).toHaveLength(1);
});

test('a preview the API marks stale gets a banner too', async () => {
  const preview = example<Schemas['Preview']>('getLatestPreview', '200');
  server.use(http.get('/api/v1/matters/:matterId/previews/latest', () => HttpResponse.json({ ...preview, stale: true })));
  renderApp(PATH);
  await loaded();
  const banner = screen.getByText('This preview is out of date.').closest('[role="status"]') as HTMLElement;
  expect(within(banner).getByRole('button', { name: 'Preview again' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Refresh preview' })).not.toBeInTheDocument();
});

test('a current preview has no stale banner', async () => {
  renderApp(PATH);
  await loaded();
  expect(screen.queryByText(/hasn't been previewed|has changed since this preview|out of date/)).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Refresh preview' })).toBeEnabled();
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
  test('the caption uses the same words as the status line', () => {
    expect(captionText(null)).toBe('Items');
    expect(captionText({ dimension: 'type', name: 'Email', count: 223 })).toBe('Items where the type is Email');
    expect(captionText({ dimension: 'location', name: 'Alex Wilber', count: 312 })).toBe('Items where the location is Alex Wilber');
  });
  test('when the preview was made, after "cull v3"', () => {
    const now = new Date(2026, 10, 5, 15, 0);
    expect(madeWhen(new Date(2026, 10, 5, 10, 42).toISOString(), now)).toBe('at 10:42');
    expect(madeWhen(new Date(2026, 10, 4, 16, 20).toISOString(), now)).toBe('yesterday at 16:20');
    expect(madeWhen(new Date(2026, 9, 28, 9, 0).toISOString(), now)).toBe('on 28 Oct');
  });
  test("the download's file name comes from Content-Disposition, or is preview.csv", () => {
    expect(fileNameOf('attachment; filename="M-2026-0142 preview v3.csv"')).toBe('M-2026-0142 preview v3.csv');
    expect(fileNameOf('attachment; filename=plain.csv')).toBe('plain.csv');
    expect(fileNameOf("attachment; filename=\"x.csv\"; filename*=UTF-8''M%C3%BCller%20v3.csv")).toBe('Müller v3.csv');
    expect(fileNameOf('attachment')).toBe('preview.csv');
    expect(fileNameOf(null)).toBe('preview.csv');
  });
});
