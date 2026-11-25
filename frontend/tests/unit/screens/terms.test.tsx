import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { onlineManager } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { findMatter } from '@/mocks/db';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { barPercent, changeHeader, changeText, sizeText, whenText } from '@/screens/terms/format';
import { isNewerReport } from '@/screens/terms/hooks';
import { expectNoA11yViolations } from '../a11y';
import { FALCON, get, post, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

// Poll jobs every 20 ms instead of every few seconds; the jobs themselves follow the mock clock, which tick() moves
// (importing ../mocks/api freezes it for each test).
vi.mock('@/api/jobs', async (importOriginal) => {
  const jobs = await importOriginal<typeof import('@/api/jobs')>();
  return {
    ...jobs,
    useTrackedJob: (...[matterId, kind, options]: Parameters<typeof jobs.useTrackedJob>) =>
      jobs.useTrackedJob(matterId, kind, { pollMs: () => 20, ...options }),
  };
});

const PATH = `/matters/${FALCON}/terms`;
const reportTable = () => screen.findByRole('table', { name: /^Search term report/ });
const bodyRows = (table: HTMLElement) => within(table.querySelector('tbody')!).getAllByRole('row');
// The Recount button: the toolbar's, or the stale report's banner's while the count is out of date (never both).
const recount = () => screen.getByRole('button', { name: 'Recount' });
// The progress block, which takes focus when the button that started the count goes away.
const progressBlock = () => screen.getByRole('progressbar').closest<HTMLElement>('[tabindex="-1"]');
// What the latest report's time says, for the report the mock wrote last.
const countedAt = (iso: string) => new RegExp(`^Counted ${whenText(iso)} for query v3\\.`);

/** A promise a test opens when it chooses, to hold a request back. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((resolve) => (open = resolve));
  return { wait, open };
}

/** Run one count to the end on the Falcon matter, from the screen. */
async function countOnce() {
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  await waitFor(() => expect(recount()).toBeEnabled());
}

test('the latest term report shows hits per term, with bars, the change since the last version and sizes', async () => {
  renderApp(PATH);
  const table = await reportTable();
  expect(screen.getByRole('heading', { level: 2, name: 'Terms' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 3, name: 'Search term report' })).toBeInTheDocument();
  expect(screen.getByText(/^Counted .* for query v3\. Each term is counted inside every other filter/)).toBeInTheDocument();

  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toEqual(['Term', 'Hits within scope', 'Since v2', 'Size']);
  const rows = bodyRows(table).map((row) => [...row.querySelectorAll('th, td')].map((cell) => cell.textContent));
  expect(rows).toEqual([
    ['"project falcon"', '105', '−83 from 188', '4.8 MB'],
    ['invoic*', '440', '−362 from 802', '20.2 MB'],
    ['kickback', '258', '−113 from 371', '11.9 MB'],
    ['"side letter"', '316', 'New in v3', '14.5 MB'],
  ]);
  const total = within(table.querySelector('tfoot')!).getByRole('row');
  expect(within(total).getByRole('rowheader')).toHaveTextContent('All terms combined');
  expect(total).toHaveTextContent('630');
  expect(total).toHaveTextContent('29.0 MB');

  // Each bar is the term's share of all terms combined.
  const fill = (row: HTMLElement) => row.querySelector<HTMLElement>('[aria-hidden="true"] > span')!.style.width;
  expect(parseFloat(fill(bodyRows(table)[1]!))).toBeCloseTo((440 / 630) * 100, 2);
  expect(fill(total)).toBe('100%');

  expect(screen.queryByText('The query has changed since this count.')).not.toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  // Out of scope for V1: unique hits and "Try without".
  expect(screen.queryByText(/unique/i)).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Try without/ })).not.toBeInTheDocument();
  await expectNoA11yViolations(document.body);
});

test('Recount starts a term report, shows its progress, and then shows the new report', async () => {
  renderApp(PATH);
  await reportTable();
  // The live region is there, empty, before the count starts, so its first words are read out.
  expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  await userEvent.click(recount());

  const bar = await screen.findByRole('progressbar', { name: 'Counting hits per term' });
  expect(screen.getByText('Starting the count…')).toBeInTheDocument();
  expect(recount()).toBeDisabled();
  // Only the phase is a live region: not the long note, and not the percent, which the progress bar carries.
  expect(screen.getByRole('status')).toHaveTextContent(/^Starting the count…$/);
  expect(screen.getByText('0%')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  tick(4.5); // half of the 9 seconds a mock job takes
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
  expect(screen.getByText('50%')).toBeInTheDocument();
  expect(screen.getByRole('status')).toHaveTextContent(/^Counting hits per term…$/);

  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  await waitFor(() => expect(screen.getByText(countedAt('2026-11-05T12:00:14Z'))).toBeInTheDocument());
  expect(screen.getByRole('status')).toHaveTextContent(/^$/);
  expect(recount()).toBeEnabled();
  expect(bodyRows(await reportTable())).toHaveLength(4);
});

test('while a new count is being started after one finished, the progress starts from nothing, not the last 100%', async () => {
  renderApp(PATH);
  await reportTable();
  await countOnce();

  const held = gate();
  server.use(
    http.post('/api/v1/matters/:matterId/term-reports', async () => {
      await held.wait;
      return undefined; // then on to the mock
    }),
  );
  await userEvent.click(recount());
  const bar = await screen.findByRole('progressbar', { name: 'Counting hits per term' });
  expect(bar).toHaveAttribute('aria-valuenow', '0');
  expect(screen.getByRole('status')).toHaveTextContent(/^Starting the count…$/);
  expect(screen.getByText('0%')).toBeInTheDocument();
  expect(screen.queryByText('Counting hits per term…')).not.toBeInTheDocument();

  held.open();
  await waitFor(async () => expect((await get(`/matters/${FALCON}/jobs`, { active: true, kind: 'term_report' })).json.items).toHaveLength(1));
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
});

test('when a count finishes, its report shows at once, without waiting for the report to be fetched again', async () => {
  renderApp(PATH);
  await reportTable();
  const held = gate();
  server.use(
    http.get('/api/v1/matters/:matterId/term-reports/latest', async () => {
      await held.wait;
      return undefined;
    }),
  );
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  // The same render that drops the progress shows the new report, though the refetch is still held.
  expect(screen.getByText(new RegExp(`^Counted ${whenText('2026-11-05T12:00:14Z')} for query v3\\.`))).toBeInTheDocument();
  held.open();
  await waitFor(() => expect(recount()).toBeEnabled());
});

test('the first count of a matter shows its report at once, with no flash of the empty state', async () => {
  renderApp('/matters/mat_travel/terms');
  await userEvent.click(await screen.findByRole('button', { name: 'Count hits per term' }));
  const held = gate();
  server.use(
    http.get('/api/v1/matters/:matterId/term-reports/latest', async () => {
      await held.wait;
      return undefined;
    }),
  );
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(screen.queryByText('No term report yet')).not.toBeInTheDocument();
  expect(screen.getByRole('table', { name: /^Search term report/ })).toBeInTheDocument();
  held.open();
});

test('a finished count is kept as the latest report: leaving and coming back before the refetch lands still shows it', async () => {
  const router = renderApp(PATH);
  await reportTable();
  const before = screen.getByText(/^Counted /).textContent;
  const held = gate();
  server.use(
    http.get('/api/v1/matters/:matterId/term-reports/latest', async () => {
      await held.wait;
      return undefined;
    }),
  );
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  tick(10);
  await waitFor(() => expect(screen.getByText(countedAt('2026-11-05T12:00:14Z'))).toBeInTheDocument());

  await act(() => router.navigate(`/matters/${FALCON}/log`));
  await waitFor(() => expect(screen.queryByRole('table', { name: /^Search term report/ })).not.toBeInTheDocument());
  await act(() => router.navigate(PATH));
  // No job to take the report from now, and the refetch is still held: the cache has the new report.
  expect(await screen.findByText(countedAt('2026-11-05T12:00:14Z'))).toBeInTheDocument();
  expect(screen.getByText(/^Counted /).textContent).not.toBe(before);
  held.open();
});

test('the refetched copy of the report a count just made wins, even with its time written differently', async () => {
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  // From now on the API writes the same report's time as "+00:00" with microseconds, and says it's out of date
  // (the query changed just after the count), which the job's own copy can't know.
  server.use(
    http.get('/api/v1/matters/:matterId/term-reports/latest', () => {
      const report = findMatter(FALCON)!.termReport!;
      return HttpResponse.json({ ...report, created_at: report.created_at.replace(/Z$/, '.000000+00:00'), stale: true });
    }),
  );
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(await screen.findByText('The query has changed since this count.')).toBeInTheDocument();
  expect(screen.getByText(countedAt('2026-11-05T12:00:14Z'))).toBeInTheDocument();
});

test("a count that finished on one matter isn't shown on the next matter's Terms", async () => {
  const router = renderApp(PATH);
  await reportTable();
  await countOnce();
  await act(() => router.navigate('/matters/mat_travel/terms'));
  expect(await screen.findByText('No term report yet')).toBeInTheDocument();
  expect(screen.queryByRole('table', { name: /^Search term report/ })).not.toBeInTheDocument();
});

test("a count still running on one matter isn't shown on the next matter's Terms", async () => {
  const router = renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  await act(() => router.navigate('/matters/mat_travel/terms'));
  expect(await screen.findByText('No term report yet')).toBeInTheDocument();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('opening the screen while a term report runs picks up its progress instead of offering to start another', async () => {
  const job = (await post(`/matters/${FALCON}/term-reports`)).json as { id: string };
  expect(job.id).toBeTruthy();
  tick(3);
  renderApp(PATH);

  const bar = await screen.findByRole('progressbar', { name: 'Counting hits per term' });
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '33'));
  await waitFor(() => expect(recount()).toBeDisabled());

  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(recount()).toBeEnabled();
});

test('a term report started elsewhere while the screen is open is followed when Recount finds it running', async () => {
  renderApp(PATH);
  await reportTable();
  await post(`/matters/${FALCON}/term-reports`); // another tab starts one
  await userEvent.click(recount()); // the API answers 409 with that job's id

  expect(await screen.findByRole('progressbar', { name: 'Counting hits per term' })).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
});

test('a running count that Recount was handed (409) and that then fails still says it failed', async () => {
  setScenario({ failJobs: ['term_report'] });
  renderApp(PATH);
  await reportTable();
  await post(`/matters/${FALCON}/term-reports`); // another tab starts one, which will fail
  await userEvent.click(recount()); // the API answers 409 with that job's id
  await screen.findByRole('progressbar');
  tick(10);

  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 3, name: "Purview couldn't finish that" })).toBeInTheDocument();
});

test('a term report that fails says why, keeps the last report, and can be tried again', async () => {
  setScenario({ failJobs: ['term_report'] });
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  tick(10);

  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 3, name: "Purview couldn't finish that" })).toBeInTheDocument();
  expect(bodyRows(await reportTable())).toHaveLength(4); // the earlier report is still shown
  await expectNoA11yViolations(document.body);

  setScenario({ failJobs: [] });
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  tick(10);
  await waitFor(() => expect(screen.queryByRole('progressbar')).not.toBeInTheDocument());
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('after a failed count, a Recount the API refuses shows only why it was refused', async () => {
  setScenario({ failJobs: ['term_report'] });
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  await screen.findByRole('progressbar');
  tick(10);
  await screen.findByRole('heading', { level: 3, name: "Purview couldn't finish that" });

  setScenario({ failJobs: [] });
  findMatter(FALCON)!.draft.criteria.keywords = [];
  await userEvent.click(recount());
  await screen.findByRole('heading', { name: "These search settings can't be turned into a query" });
  expect(screen.getAllByRole('alert')).toHaveLength(1);
  expect(screen.queryByRole('heading', { name: "Purview couldn't finish that" })).not.toBeInTheDocument();
});

test('a refused Recount is dropped once a count started elsewhere is followed, so that count can say it failed', async () => {
  setScenario({ failJobs: ['term_report'] });
  const keywords = [...findMatter(FALCON)!.draft.criteria.keywords];
  findMatter(FALCON)!.draft.criteria.keywords = [];
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  await screen.findByRole('heading', { name: "These search settings can't be turned into a query" });

  findMatter(FALCON)!.draft.criteria.keywords = keywords;
  await post(`/matters/${FALCON}/term-reports`); // another tab starts one, which will fail
  // Coming back online asks again what's running, and finds it.
  act(() => {
    onlineManager.setOnline(false);
    onlineManager.setOnline(true);
  });
  await screen.findByRole('progressbar');
  await waitFor(() => expect(screen.queryByRole('heading', { name: "These search settings can't be turned into a query" })).not.toBeInTheDocument());
  tick(10);
  expect(await screen.findByRole('heading', { level: 3, name: "Purview couldn't finish that" })).toBeInTheDocument();
  expect(screen.getAllByRole('alert')).toHaveLength(1);
});

test('a count that fails without saying why still says it failed', async () => {
  server.use(
    http.get('/api/v1/jobs/:jobId', ({ params }) =>
      HttpResponse.json({
        id: params.jobId,
        kind: 'term_report',
        status: 'failed',
        progress: 0.4,
        matter_id: FALCON,
        created_at: '2026-11-05T12:00:00Z',
        updated_at: '2026-11-05T12:00:04Z',
        result: null,
        error: null,
      }),
    ),
  );
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { level: 3, name: "Purview couldn't finish that" })).toBeInTheDocument();
  expect(alert).toHaveTextContent('Try again. If it keeps failing, check the case in the Purview portal.');
  expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});

test('when the query changed since the report, the screen says the counts are out of date', async () => {
  findMatter(FALCON)!.draft.criteria.keywords.push('bribe');
  renderApp(PATH);
  const table = await reportTable();
  const notice = (await screen.findByText('The query has changed since this count.')).closest<HTMLElement>('[role="status"]')!;
  expect(notice).toHaveTextContent('These hits are for query v3.');
  expect(table).toHaveAttribute('data-stale', 'true');
  await expectNoA11yViolations(document.body);

  // The banner says to choose Recount, and has the button: the only Recount on the screen while it shows.
  expect(screen.getAllByRole('button', { name: 'Recount' })).toHaveLength(1);
  await userEvent.click(within(notice).getByRole('button', { name: 'Recount' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByText('The query has changed since this count.')).not.toBeInTheDocument();
  // The banner and its button are gone, so focus moves to the progress rather than dropping to the page.
  expect(progressBlock()).toHaveFocus();
  // The toolbar's Recount is back, waiting for the count.
  expect(screen.getByRole('button', { name: 'Recount' })).toBeDisabled();
});

test('a term report the API refuses to start says why in plain English', async () => {
  findMatter(FALCON)!.draft.criteria.keywords = [];
  renderApp(PATH);
  await reportTable();
  await userEvent.click(recount());
  const alert = await screen.findByRole('alert');
  expect(within(alert).getByRole('heading', { name: "These search settings can't be turned into a query" })).toBeInTheDocument();
  expect(alert).toHaveTextContent('There are no search terms to count. Add at least one term first.');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('before any term report, the screen offers to count, and then shows the first report', async () => {
  renderApp('/matters/mat_travel/terms');
  expect(await screen.findByText('No term report yet')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Recount' })).not.toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  await userEvent.click(screen.getByRole('button', { name: 'Count hits per term' }));
  expect(await screen.findByRole('progressbar')).toBeInTheDocument();
  expect(screen.queryByText('No term report yet')).not.toBeInTheDocument();
  expect(progressBlock()).toHaveFocus();
  tick(10);

  const table = await reportTable();
  expect(within(table).getAllByRole('columnheader').map((th) => th.textContent)).toContain('Since last count');
  expect(bodyRows(table)[0]).toHaveTextContent('No earlier count');
  expect(screen.queryByText('No term report yet')).not.toBeInTheDocument();
});

test('a matter with no query yet is sent to Scope to estimate one first', async () => {
  const created = (await post('/matters', { matter_number: 'M-2026-0300', name: 'New matter', type: 'investigation' })).json as { id: string };
  renderApp(`/matters/${created.id}/terms`);
  expect(await screen.findByText('No term report yet')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: 'Go to Scope' })).toHaveAttribute('href', `/matters/${created.id}/scope`);
  expect(screen.queryByRole('button', { name: 'Count hits per term' })).not.toBeInTheDocument();
});

test('a report that cannot be loaded says so, and can be asked for again', async () => {
  let fail = true;
  server.use(
    http.get('/api/v1/matters/:matterId/term-reports/latest', () =>
      fail ? HttpResponse.json({ code: 'internal_error', message: 'The database is busy.', details: {} }, { status: 500 }) : undefined,
    ),
  );
  renderApp(PATH);
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('The database is busy.');
  fail = false;
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await reportTable()).toBeInTheDocument();
});

describe('how the screen writes things', () => {
  const row = (items: number, previous_items: number | null, previous_version: number | null = 2) => ({ term: 'x', items, size_bytes: 0, previous_items, previous_version });

  test('the change since the previous version', () => {
    expect(changeText(row(105, 188), 3, 2)).toBe('−83 from 188');
    expect(changeText(row(1_200, 900), 3, 2)).toBe('+300 from 900');
    expect(changeText(row(40, 40), 3, 2)).toBe('No change from 40');
    expect(changeText(row(316, null), 3, 2)).toBe('New in v3');
    // A new term is new whenever the report had an earlier count, whatever its own row says.
    expect(changeText(row(316, null, null), 3, 2)).toBe('New in v3');
    expect(changeText(row(10, null, null), 1, null)).toBe('No earlier count');
    expect(changeHeader([row(1, null), row(2, 5, 2)])).toBe('Since v2');
    expect(changeHeader([row(1, null, null)])).toBe('Since last count');
  });

  test('which of two reports is the later one', () => {
    const a = { id: 'trm_1', created_at: '2026-11-05T12:00:14Z' };
    // The same report, its time written another way: neither is later.
    expect(isNewerReport(a, { id: 'trm_1', created_at: '2026-11-05T12:00:14.000000+00:00' })).toBe(false);
    expect(isNewerReport({ id: 'trm_1', created_at: '2026-11-05T12:00:14.123456Z' }, a)).toBe(false);
    // Another report: by its instant, not by how the string sorts ("Z" sorts after "+").
    expect(isNewerReport({ id: 'trm_2', created_at: '2026-11-05T12:00:14Z' }, { id: 'trm_1', created_at: '2026-11-05T12:00:14+00:00' })).toBe(false);
    expect(isNewerReport({ id: 'trm_2', created_at: '2026-11-05T13:00:00+01:00' }, a)).toBe(false);
    expect(isNewerReport({ id: 'trm_2', created_at: '2026-11-05T12:00:15+00:00' }, a)).toBe(true);
  });

  test('sizes, bars and times', () => {
    expect(sizeText(30_408_704)).toBe('29.0 MB');
    expect(sizeText(5_033_164)).toBe('4.8 MB');
    expect(sizeText(2_048)).toBe('2 KB');
    expect(sizeText(512)).toBe('512 B');
    expect(sizeText(3 * 1024 ** 3)).toBe('3.0 GB');
    expect(barPercent(315, 630)).toBe(50);
    expect(barPercent(700, 630)).toBe(100);
    expect(barPercent(5, 0)).toBe(0);
    const now = new Date(2026, 10, 5, 15, 0);
    expect(whenText(new Date(2026, 10, 5, 10, 51).toISOString(), now)).toBe('at 10:51');
    expect(whenText(new Date(2026, 10, 4, 16, 20).toISOString(), now)).toBe('yesterday at 16:20');
    expect(whenText(new Date(2026, 9, 28, 9, 5).toISOString(), now)).toBe('on 28 Oct at 09:05');
    expect(whenText(new Date(2025, 9, 28, 9, 5).toISOString(), now)).toBe('on 28 Oct 2025 at 09:05');
  });
});

test("the screen's styles use the design tokens, not raw colours", () => {
  const css = readFileSync(resolve(__dirname, '../../../src/screens/terms/TermsScreen.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
  const tokens = readFileSync(resolve(__dirname, '../../../src/styles/tokens.css'), 'utf8');
  for (const [, name] of css.matchAll(/var\((--st-[a-z0-9-]+)/g)) expect(tokens).toContain(`${name}:`);
});
