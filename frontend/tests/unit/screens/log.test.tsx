import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { pollDelay } from '@/api/jobs';
import { findMatter } from '@/mocks/db';
import { appendLog } from '@/mocks/log';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { countChange, dayText, shortHash, versionNote, whenText } from '@/screens/log/format';
import { logPolling } from '@/screens/log/hooks';
import { methodologyReport, stamp } from '@/screens/log/report';
import type { Schemas } from '@/api/client';
import { expectNoA11yViolations } from '../a11y';
import { FALCON, post, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

const LOG = `/matters/${FALCON}/log`;

type RequestListener = Parameters<typeof server.events.on<'request:start'>>[1];
const listeners: RequestListener[] = [];

/** Count the requests to a path (and method) while a test runs. */
function countRequests(method: string, pathEnd: string) {
  const seen: URL[] = [];
  const listener: RequestListener = ({ request }) => {
    const url = new URL(request.url);
    if (request.method === method && url.pathname.endsWith(pathEnd)) seen.push(url);
  };
  server.events.on('request:start', listener);
  listeners.push(listener);
  return seen;
}

const entries = () => within(screen.getByRole('list', { name: 'Log entries, newest first' })).getAllByRole('listitem');
/** The entry numbers shown, newest first. */
const seqs = () => entries().map((row) => row.textContent?.match(/^Entry (\d+)/)?.[1]);
const jobUpdates = () => screen.getByRole('status', { name: 'Job updates' });

/** Watch the report the screen saves: the file's name and text. */
function catchReports() {
  const saved: { name: string; blob: Blob }[] = [];
  // jsdom has no object URLs, so they are given first, then watched.
  Object.assign(URL, { createObjectURL: () => '', revokeObjectURL: () => undefined });
  const create = vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => {
    saved.push({ name: '', blob: blob as Blob });
    return 'blob:report';
  });
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (this: HTMLAnchorElement) {
    saved[saved.length - 1]!.name = this.download;
  });
  return { saved, create, revoke };
}

afterEach(() => {
  logPolling.pollMs = pollDelay;
  logPolling.idleMs = 10_000;
  for (const listener of listeners.splice(0)) server.events.removeListener('request:start', listener);
  vi.restoreAllMocks();
});

test('the versions show how the set narrowed, oldest first, with their counts and what changed', async () => {
  renderApp(LOG);
  const list = await screen.findByRole('list', { name: 'Query versions' });
  const rows = within(list).getAllByRole('listitem');
  expect(rows.map((row) => row.textContent)).toEqual([
    expect.stringMatching(/^v1.*"project falcon", invoic\* · all dates.*3,912 items$/),
    expect.stringMatching(/^v2.*added kickback, a date range and a newsletter domain exclusion · exported.*1,148 items$/),
    expect.stringMatching(/^v3.*added "side letter".*630 items$/),
  ]);
  expect(screen.getByRole('heading', { level: 2, name: 'How the set narrowed' })).toBeInTheDocument();
});

test('entries are newest first, each with its action, who and when, and the hash before it and its own', async () => {
  renderApp(LOG);
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  const rows = entries();
  expect(rows).toHaveLength(8);
  expect(seqs()).toEqual(['8', '7', '6', '5', '4', '3', '2', '1']);
  expect(screen.getByRole('listitem', { name: 'Entry 8' })).toBe(rows[0]);
  const newest = within(rows[0]!);
  expect(newest.getByText('Term report')).toBeInTheDocument();
  expect(newest.getByText('Query v3 · 4 terms counted')).toBeInTheDocument();
  expect(newest.getByText(/Dana Whitfield/)).toBeInTheDocument();
  expect(rows[0]).toHaveTextContent('prev 9050…9f4b → hash cd7c…3329');
  // The full hash is there to read on hover.
  expect(newest.getByText('cd7c…3329')).toHaveAttribute('title', 'cd7c2de3013d2eeac2f7d8bb6abd56515813a04e172e75a17e9b79002a003329');
  expect(within(rows[2]!).getByText('Export finished')).toBeInTheDocument();
  expect(within(rows[2]!).getByText(/SearchTrail/)).toBeInTheDocument();
  expect(rows[7]).toHaveTextContent('prev 0000…0000');
  // No pages for eight entries.
  expect(screen.queryByRole('navigation', { name: 'Log pages' })).not.toBeInTheDocument();
});

test('the chain is checked when the screen opens, and again on "Verify again"', async () => {
  const verifies = countRequests('POST', `/matters/${FALCON}/log/verify`);
  renderApp(LOG);
  expect(await screen.findByText(/^Chain intact · 8 entries verified (at|on \d+ \w+ at) \d\d:\d\d$/)).toBeInTheDocument();
  expect(verifies).toHaveLength(1);
  // The next check waits until the test lets it answer.
  let answer = () => {};
  const held = new Promise<void>((resolve) => (answer = resolve));
  server.use(
    http.post('/api/v1/matters/:matterId/log/verify', async () => {
      await held;
      return undefined; // then the mock's own answer
    }),
  );
  const again = screen.getByRole('button', { name: 'Verify again' });
  await userEvent.click(again);
  // While it checks, the button stays focusable (and focused) but a second press sends nothing.
  const busy = await screen.findByRole('button', { name: 'Verifying…' });
  expect(busy).toBe(again);
  expect(busy).toHaveFocus();
  expect(busy).toHaveAttribute('aria-disabled', 'true');
  expect(busy).not.toBeDisabled();
  await userEvent.click(busy);
  answer();
  await waitFor(() => expect(screen.getByRole('button', { name: 'Verify again' })).toHaveAttribute('aria-disabled', 'false'));
  expect(verifies).toHaveLength(2);
  expect(again).toHaveFocus();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
});

test('the screen passes the accessibility checks', async () => {
  renderApp(LOG);
  await screen.findByText(/^Chain intact/);
  await screen.findByText('1,148 → 630 items (−518)');
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  await expectNoA11yViolations(document.body);
});

test('a tampered log fails its check at entry 5: the result says so, and the entry is marked', async () => {
  setScenario({ logTampered: true });
  renderApp(LOG);
  expect(await screen.findByText(/^Chain broken at entry 5 · checked (at|on \d+ \w+ at) \d\d:\d\d$/)).toBeInTheDocument();
  const alert = screen.getByRole('alert');
  expect(alert).toHaveTextContent('This log fails its check.');
  expect(alert).toHaveTextContent('Entry 5: contents were modified after it was written. Something changed');
  expect(alert.textContent).not.toContain('..');
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  const fifth = entries()[3]!;
  expect(fifth).toHaveAccessibleName('Entry 5');
  expect(fifth).toHaveTextContent('This entry fails the check');
  expect(screen.getAllByText(/This entry fails the check/)).toHaveLength(1);
  await expectNoA11yViolations(document.body);
});

test('the log is paged, newest first; the failing entry can be found on its page', async () => {
  const falcon = findMatter(FALCON)!;
  for (let i = 0; i < 17; i += 1) appendLog(falcon, 'matter_updated', `Change ${i + 1}`);
  setScenario({ logTampered: true });
  const pages = countRequests('GET', `/matters/${FALCON}/log`);
  renderApp(LOG);
  const nav = await screen.findByRole('navigation', { name: 'Log pages' });
  expect(nav).toHaveTextContent('Entries 1–20 of 25');
  expect(seqs()[0]).toBe('25');
  expect(entries()[0]).toHaveTextContent('Change 17');
  expect(within(nav).getByRole('button', { name: 'Newer' })).toHaveAttribute('aria-disabled', 'true');
  expect(pages.at(-1)!.searchParams.get('page_size')).toBe('20');

  // A press on a button that can't be used does nothing.
  const before = pages.length;
  await userEvent.click(within(nav).getByRole('button', { name: 'Newer' }));
  expect(pages).toHaveLength(before);

  await userEvent.click(within(nav).getByRole('button', { name: 'Older' }));
  await waitFor(() => expect(screen.getByRole('navigation', { name: 'Log pages' })).toHaveTextContent('Entries 21–25 of 25'));
  expect(pages.at(-1)!.searchParams.get('page')).toBe('2');
  expect(seqs()).toEqual(['5', '4', '3', '2', '1']);
  expect(screen.getByRole('button', { name: 'Older' })).toHaveAttribute('aria-disabled', 'true');
  // Focus moves to the new page's entries, read from the top.
  await waitFor(() => expect(screen.getByRole('list', { name: 'Log entries, newest first' })).toHaveFocus());

  await userEvent.click(screen.getByRole('button', { name: 'Newer' }));
  await waitFor(() => expect(seqs()[0]).toBe('25'));
  await waitFor(() => expect(screen.getByRole('list', { name: 'Log entries, newest first' })).toHaveFocus());
  expect(screen.queryByText(/This entry fails the check/)).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Show entry 5' }));
  expect(await screen.findByText(/This entry fails the check/)).toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('listitem', { name: 'Entry 5' })).toHaveFocus());
  expect(screen.getByRole('navigation', { name: 'Log pages' })).toHaveTextContent('Entries 21–25 of 25');
});

test('compare shows the newest pair first, and another pair on request', async () => {
  const compares = countRequests('GET', `/matters/${FALCON}/versions/compare`);
  renderApp(LOG);
  const card = (await screen.findByRole('heading', { level: 2, name: 'Compare versions' })).closest('section')!;
  const group = within(card).getByRole('group', { name: 'Versions to compare' });
  expect(within(group).getByRole('button', { name: 'v2 → v3' })).toHaveAttribute('aria-pressed', 'true');
  expect(await within(card).findByText('1,148 → 630 items (−518)')).toBeInTheDocument();
  const changes = within(within(card).getByRole('list', { name: 'Changes' })).getAllByRole('listitem');
  expect(changes.map((li) => li.textContent!.slice(1))).toEqual([ // after the + or − mark
    'Added: Added term "side letter"',
    'Added: Excluding items containing "weekly digest"',
    'Added: Excluding items labelled Public',
    'Added: Documents limited to docx, xlsx, pptx, pdf',
    'Removed: Documents of any file type',
  ]);
  expect(card).toHaveTextContent('Unchanged: custodians, sites, date range, terms "project falcon", invoic* and kickback.');
  expect(compares.at(-1)!.search).toBe('?from=2&to=3');

  await userEvent.click(within(group).getByRole('button', { name: 'v1 → v2' }));
  expect(await within(card).findByText('3,912 → 1,148 items (−2,764)')).toBeInTheDocument();
  expect(compares.at(-1)!.search).toBe('?from=1&to=2');
  expect(within(group).getByRole('button', { name: 'v1 → v2' })).toHaveAttribute('aria-pressed', 'true');
});

test('with one version there is nothing to compare yet', async () => {
  renderApp('/matters/mat_harlow/log');
  expect(await screen.findByText(/There is only one query version so far/)).toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Versions to compare' })).not.toBeInTheDocument();
});

test('with no versions the screen says how to make one', async () => {
  server.use(http.get('/api/v1/matters/:matterId/versions', () => HttpResponse.json({ items: [] })));
  renderApp(LOG);
  expect(await screen.findByText(/No query versions yet/)).toBeInTheDocument();
  expect(screen.getByText('There are no query versions to compare yet.')).toBeInTheDocument();
});

test('many versions are offered in a list', async () => {
  renderApp('/matters/mat_brightwell/log'); // four versions: three pairs, still buttons
  expect(await screen.findByRole('group', { name: 'Versions to compare' })).toBeInTheDocument();
  const brightwell = findMatter('mat_brightwell')!;
  const base = brightwell.versions.at(-1)!;
  brightwell.versions.push({ ...base, version: 5 }, { ...base, version: 6 });
  cleanup(); // one app at a time
  renderApp('/matters/mat_brightwell/log');
  const select = await screen.findByRole('combobox', { name: 'Versions to compare' });
  expect(select).toHaveValue('6');
  const compares = countRequests('GET', '/matters/mat_brightwell/versions/compare');
  await userEvent.selectOptions(select, 'v2 → v3');
  await waitFor(() => expect(compares.at(-1)?.search).toBe('?from=2&to=3'));
});

test('a job running on the matter shows its progress, and its entry appears when it finishes', async () => {
  logPolling.pollMs = () => 20;
  await post(`/matters/${FALCON}/previews`);
  renderApp(LOG);
  const status = await screen.findByText(/^A preview is running \(\d+%\)\. Its entry is added here when it finishes\.$/);
  expect(status).toBeInTheDocument();
  tick(4.5);
  expect(await screen.findByText(/^A preview is running \(50%\)/)).toBeInTheDocument();
  tick(10);
  await waitFor(() => expect(screen.queryByText(/is running/)).not.toBeInTheDocument());
  await waitFor(() => expect(entries()).toHaveLength(9));
  expect(entries()[0]).toHaveTextContent('Preview');
  expect(await screen.findByText(/^Chain intact · 9 entries verified/)).toBeInTheDocument();
});

test('a job started elsewhere while the screen is open shows up, and only its start and finish are announced', async () => {
  logPolling.pollMs = () => 20;
  logPolling.idleMs = 30;
  renderApp(LOG);
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  // The live region is on the page before anything runs, and quiet.
  expect(jobUpdates()).toBeEmptyDOMElement();

  await post(`/matters/${FALCON}/previews`); // as another tab would
  const progress = await screen.findByText(/^A preview is running \(\d+%\)/);
  await waitFor(() => expect(jobUpdates()).toHaveTextContent('A preview started.'));
  expect(jobUpdates()).not.toContainElement(progress);
  tick(4.5);
  await screen.findByText(/^A preview is running \(50%\)/);
  expect(jobUpdates()).toHaveTextContent(/^A preview started\.$/);

  tick(10);
  await waitFor(() => expect(jobUpdates()).toHaveTextContent(/^A preview finished\.$/));
  await waitFor(() => expect(entries()).toHaveLength(9));
  expect(screen.queryByText(/is running/)).not.toBeInTheDocument();
});

test('a job already running when the screen opens is picked up (reopening the screen resumes it)', async () => {
  logPolling.pollMs = () => 20;
  await post(`/matters/${FALCON}/term-reports`);
  tick(3);
  const first = renderApp(LOG);
  expect(await screen.findByText(/^A term report is running/)).toBeInTheDocument();
  await first.navigate(`/matters/${FALCON}/define`);
  await first.navigate(LOG);
  expect(await screen.findByText(/^A term report is running/)).toBeInTheDocument();
});

test('a log that cannot be read says why, and can be asked for again', async () => {
  let fail = true;
  server.use(
    http.get('/api/v1/matters/:matterId/log', ({ request }) =>
      fail
        ? HttpResponse.json({ code: 'internal_error', message: 'The log could not be read.', details: {} }, { status: 500 })
        : HttpResponse.json({ items: [], total: 0, page: Number(new URL(request.url).searchParams.get('page')), page_size: 20 }),
    ),
  );
  renderApp(LOG);
  const heading = await screen.findByRole('heading', { level: 3, name: 'Something went wrong on our side' }, { timeout: 3000 });
  const alert = heading.closest('[role="alert"]') as HTMLElement;
  expect(alert).toHaveTextContent('The log could not be read.');
  fail = false;
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText('Nothing has been logged on this matter yet.')).toBeInTheDocument();
});

test('a check that cannot run says why', async () => {
  server.use(
    http.post('/api/v1/matters/:matterId/log/verify', () =>
      HttpResponse.json({ code: 'not_found', message: 'No matter with that ID.', details: {} }, { status: 404 }),
    ),
  );
  renderApp(LOG);
  expect(await screen.findByRole('heading', { name: "We can't find that" })).toBeInTheDocument();
  expect(screen.getByText('Not checked yet')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Verify' })).toBeEnabled();
});

test('a comparison that cannot be made says why', async () => {
  server.use(
    http.get('/api/v1/matters/:matterId/versions/compare', () =>
      HttpResponse.json({ code: 'validation_failed', message: 'from and to must be query version numbers.', details: {} }, { status: 400 }),
    ),
  );
  renderApp(LOG);
  const card = (await screen.findByRole('heading', { level: 2, name: 'Compare versions' })).closest('section')!;
  expect(await within(card).findByRole('alert')).toHaveTextContent('from and to must be query version numbers.');
});

test('the methodology report downloads a text record of the query, its versions and the chain', async () => {
  const { saved, revoke } = catchReports();
  renderApp(LOG);
  await screen.findByText(/^Chain intact/);
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  const button = screen.getByRole('button', { name: 'Methodology report' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  expect(saved).toHaveLength(1);
  expect(saved[0]!.name).toBe('M-2026-0142 methodology v3.txt');
  const text = await saved[0]!.blob.text();
  expect(text).toContain('Matter: Project Falcon investigation (M-2026-0142)');
  expect(text).toContain('Query v3, made 2026-11-05 10:41 UTC by Dana Whitfield');
  expect(text).toContain('Counts: 630 items (29.0 MiB), plus 25 partially indexed items (21.7 MiB)');
  expect(text).toContain('1. Item types: emails, Teams chats, documents.');
  expect(text).toContain('v1: 3,912 items');
  expect(text).toMatch(/^Hash chain: intact, 8 entries verified \(checked 2026-11-05 \d\d:\d\d UTC\)$/m);
  expect(text).toContain('Newest entry: 8, hash cd7c2de3013d2eeac2f7d8bb6abd56515813a04e172e75a17e9b79002a003329');
  // The object URL is let go a moment after the click, so the download can start first.
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:report'));
});

test('the report records the newest entry whichever page is shown, and a broken chain says where', async () => {
  const falcon = findMatter(FALCON)!;
  for (let i = 0; i < 17; i += 1) appendLog(falcon, 'matter_updated', `Change ${i + 1}`);
  setScenario({ logTampered: true });
  const head = falcon.log.at(-1)!;
  const { saved } = catchReports();
  renderApp(LOG);
  await screen.findByText(/^Chain broken at entry 5/);
  await userEvent.click(await screen.findByRole('button', { name: 'Older' }));
  await waitFor(() => expect(seqs()).toEqual(['5', '4', '3', '2', '1']));
  await userEvent.click(screen.getByRole('button', { name: 'Methodology report' }));
  const text = await saved[0]!.blob.text();
  expect(text).toContain(`Newest entry: 25, hash ${head.hash}`);
  expect(text).toMatch(/^Hash chain: BROKEN at entry 5 — Entry 5: contents were modified after it was written \(checked .+ UTC\)$/m);
});

test('a report made before the chain could be checked says it was not checked', async () => {
  server.use(
    http.post('/api/v1/matters/:matterId/log/verify', () =>
      HttpResponse.json({ code: 'internal_error', message: 'The check could not run.', details: {} }, { status: 500 }),
    ),
  );
  const { saved } = catchReports();
  renderApp(LOG);
  await screen.findByRole('heading', { name: 'Something went wrong on our side' }, { timeout: 3000 });
  await screen.findByRole('list', { name: 'Log entries, newest first' });
  const button = screen.getByRole('button', { name: 'Methodology report' });
  await waitFor(() => expect(button).toBeEnabled());
  await userEvent.click(button);
  const text = await saved[0]!.blob.text();
  expect(text).toContain('Hash chain: not checked');
  expect(text).toContain('Newest entry: 8,');
});

test('a page of the log that cannot be read keeps the last page and its pager, with a small error', async () => {
  const falcon = findMatter(FALCON)!;
  for (let i = 0; i < 17; i += 1) appendLog(falcon, 'matter_updated', `Change ${i + 1}`);
  const failing = new Set<string>();
  server.use(
    http.get('/api/v1/matters/:matterId/log', ({ request }) => {
      const page = new URL(request.url).searchParams.get('page') ?? '1';
      if (failing.has(page)) return HttpResponse.json({ code: 'internal_error', message: 'The log could not be read.', details: {} }, { status: 500 });
      return undefined; // the mock's own answer
    }),
  );
  renderApp(LOG);
  await screen.findByRole('navigation', { name: 'Log pages' });

  // Opening a page that fails: the page before stays, with its pager, and the error says so.
  failing.add('2');
  await userEvent.click(screen.getByRole('button', { name: 'Older' }));
  const alert = await screen.findByRole('alert', {}, { timeout: 3000 });
  expect(alert).toHaveTextContent("The log couldn't be read just now: The log could not be read. The entries below are the last ones read.");
  expect(seqs()[0]).toBe('25');
  expect(screen.getByRole('navigation', { name: 'Log pages' })).toHaveTextContent('Entries 1–20 of 25');
  failing.delete('2');
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  await waitFor(() => expect(seqs()).toEqual(['5', '4', '3', '2', '1']));
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();

  // A fresh read of a page already shown that fails: its entries stay, and the error is shown, not hidden.
  failing.add('1');
  await userEvent.click(screen.getByRole('button', { name: 'Newer' }));
  expect(await screen.findByRole('alert', {}, { timeout: 3000 })).toHaveTextContent("The log couldn't be read just now");
  expect(seqs()[0]).toBe('25');
  expect(screen.getByRole('navigation', { name: 'Log pages' })).toBeInTheDocument();
});

describe('wording', () => {
  const now = new Date('2026-11-05T15:00:00');

  test('dates and times read like the design', () => {
    expect(whenText('2026-11-05T10:51:00', now)).toBe('Today 10:51');
    expect(whenText('2026-11-04T16:20:00', now)).toBe('Yesterday 16:20');
    expect(whenText('2026-11-03T09:12:00', now)).toBe('3 Nov 09:12');
    expect(whenText('2025-12-30T09:12:00', now)).toBe('30 Dec 2025 09:12');
    expect(dayText('2026-11-05T10:41:12', now)).toBe('Today');
  });

  test('hashes are shortened to their ends', () => {
    expect(shortHash('41d7aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa0b9c')).toBe('41d7…0b9c');
  });

  test('count changes', () => {
    expect(countChange({ from_items: 1148, to_items: 630, delta: -518 })).toBe('1,148 → 630 items (−518)');
    expect(countChange({ from_items: 630, to_items: 642, delta: 12 })).toBe('630 → 642 items (+12)');
    expect(countChange({ from_items: 630, to_items: 630, delta: 0 })).toBe('630 → 630 items (no change)');
    expect(countChange({ from_items: null, to_items: 630, delta: null })).toBe('Counts are not available for both versions');
  });

  test('an exported version says so once', () => {
    const v = { created_at: '2026-11-04T15:40:00', exported: true } as Schemas['QueryVersion'];
    expect(versionNote({ ...v, summary: 'added kickback · exported' }, now)).toBe('Yesterday · added kickback · exported');
    expect(versionNote({ ...v, summary: 'added kickback' }, now)).toBe('Yesterday · added kickback · exported');
    expect(versionNote({ ...v, exported: false, summary: 'added kickback' }, now)).toBe('Yesterday · added kickback');
  });

  test('a report without versions says so, and that the chain was not checked', () => {
    const text = methodologyReport({ matter: { name: 'New', matter_number: 'M-1', purview_case_id: null }, versions: [] });
    expect(text).toContain('Purview case: not created yet');
    expect(text).toContain('No query version yet.');
    expect(text).toContain('Hash chain: not checked');
  });

  test('the report states the chain check from its result, not its message', () => {
    const matter = { name: 'New', matter_number: 'M-1', purview_case_id: null };
    const broken = { ok: false, entries: 8, first_bad_seq: 5, message: 'Looks fine.', verified_at: '2026-11-05T12:00:00Z' };
    expect(methodologyReport({ matter, versions: [], verification: broken })).toContain(
      'Hash chain: BROKEN at entry 5 — Looks fine (checked 2026-11-05 12:00 UTC)',
    );
    const intact = { ok: true, entries: 1, first_bad_seq: null, message: 'Whatever.', verified_at: '2026-11-05T12:00:00Z' };
    expect(methodologyReport({ matter, versions: [], verification: intact })).toContain(
      'Hash chain: intact, 1 entry verified (checked 2026-11-05 12:00 UTC)',
    );
  });

  test('report times are in UTC whatever offset they were written with', () => {
    expect(stamp('2026-11-05T10:41:12Z')).toBe('2026-11-05 10:41 UTC');
    expect(stamp('2026-11-05T10:41:12.345Z')).toBe('2026-11-05 10:41 UTC');
    expect(stamp('2026-11-05T12:41:12+02:00')).toBe('2026-11-05 10:41 UTC');
    expect(stamp('2026-11-05T02:41:00-08:00')).toBe('2026-11-05 10:41 UTC');
  });
});
