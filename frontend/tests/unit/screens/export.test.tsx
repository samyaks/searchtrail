import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { findMatter } from '@/mocks/db';
import { example } from '@/mocks/examples';
import { exportCheck, exportName } from '@/mocks/handlers/exports';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import { exportStatus, exportTotals, historyItems, sizeText, whenText } from '@/screens/export/format';
import type { Schemas } from '@/api/client';
import { expectNoA11yViolations } from '../a11y';
import { FALCON, get, post, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

// Poll every 20 ms instead of every few seconds; the jobs themselves follow the mock clock, which tick() moves.
vi.mock('@/screens/export/poll', () => ({ pollMs: () => 20 }));

const PATH = `/matters/${FALCON}/export`;
const NUMBER = 'M-2026-0142';
const V2 = 'M-2026-0142 EVERLAW 20261104T1630Z';
const OPTIONS = { include_partially_indexed: true, partially_indexed_scope: 'responsiveLocations', format: 'pst', include_cloud_attachments: false, teams_transcripts: true };

afterEach(() => server.events.removeAllListeners());

/** The JSON bodies of POST requests to paths ending in `pathEnd`, as they are sent. */
function postedTo(pathEnd: string) {
  const bodies: Record<string, unknown>[] = [];
  server.events.on('request:start', ({ request }) => {
    if (request.method === 'POST' && new URL(request.url).pathname.endsWith(pathEnd)) {
      void request.clone().json().then((body: Record<string, unknown>) => bodies.push(body));
    }
  });
  return bodies;
}

async function openReady() {
  const router = renderApp(PATH);
  await screen.findByText(/Counts unchanged since the preview/);
  return router;
}

const checkCard = () => screen.getByRole('heading', { level: 2, name: 'Export check' }).closest('section')!;
const startCard = () => screen.getByRole('heading', { level: 2, name: 'Start the export' }).closest('section')!;
const confirmField = () => screen.getByLabelText(/to confirm$/);
const startButton = () => screen.getByRole('button', { name: 'Start export' });
const historyRows = () => within(screen.getByRole('table', { name: 'Exports for this matter' })).getAllByRole('row').slice(1);
const everlawCard = () => within(screen.getByRole('heading', { name: 'Hand-off to Everlaw' }).closest('section')!);
const V3 = 'M-2026-0142 EVERLAW 20261105T1058Z';

/**
 * Falcon is seeded Previewed, with its finished v2 export only. Some tests need a newer export beside it: the
 * contract's v3 export, with `changes` (Ready by default). A Preparing one is followed on the job clock (mocks/jobs.ts).
 */
function addV3Export(changes: Partial<Schemas['Export']> = {}): Schemas['Export'] {
  const v3 = { ...example<Schemas['ExportList']>('listExports', '200').items[0]!, status: 'ready', progress: 1, finished_at: '2026-11-05T11:30:00Z', ...changes } as Schemas['Export'];
  findMatter(FALCON)!.exports.unshift(v3);
  return v3;
}

test('a previewed query passes every check, and the screen shows what will be exported, how, and the history', async () => {
  renderApp(PATH);
  expect(screen.getByRole('heading', { level: 2, name: 'Export' })).toBeInTheDocument();
  await screen.findByText(/Counts unchanged since the preview/);
  const check = within(checkCard());
  expect(check.getByText('Ready')).toBeInTheDocument();
  expect(check.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    'Passed: This exact query (v3) was previewed at 10:42.',
    'Passed: Same custodians and sites as the preview.',
    expect.stringMatching(/^Passed: Counts unchanged since the preview \(re-checked \d\d:\d\d\)\.$/),
  ]);

  const what = within(screen.getByRole('heading', { name: 'What will be exported' }).closest('section')!);
  expect(what.getByText('655')).toBeInTheDocument();
  expect(what.getByText('630 matching + 25 partially indexed')).toBeInTheDocument();
  expect(what.getByText('50.7 MB')).toBeInTheDocument();
  expect(what.getByText('2 mailboxes, 4 sites')).toBeInTheDocument();

  // The methodology of the version that would be exported (v3), with its terms.
  const method = within(screen.getByRole('heading', { name: 'Methodology sent with this export' }).closest('section')!);
  expect(method.getByText('Item types: emails, Teams chats, documents.')).toBeInTheDocument();

  // The history, newest first: the v2 export (v3 is the one to start here).
  await waitFor(() => expect(historyRows()).toHaveLength(1));
  const [v2] = historyRows();
  expect(within(v2!).getByRole('rowheader')).toHaveTextContent(V2);
  expect(v2).toHaveTextContent('1,148 + 41 partial');
  expect(v2).toHaveTextContent('Ready in Purview');
  expect(v2).toHaveTextContent('Download expires 4 Dec');

  // The Everlaw steps describe the export Start would create (v3), not an older one; the other hand-offs act on the
  // newest ready export.
  const everlaw = everlawCard();
  expect(everlaw.getByText('SearchTrail starts the export of query v3 in Purview as')).toBeInTheDocument();
  expect(everlaw.getByText(/The name appears here once it has started\./)).toBeInTheDocument();
  expect(everlaw.queryByText(V2)).not.toBeInTheDocument();
  expect(everlaw.queryByRole('button', { name: 'Copy name' })).not.toBeInTheDocument();
  expect(everlaw.getByText('M-2026-0142 Project Falcon investigation')).toBeInTheDocument();
  expect(within(screen.getByRole('heading', { name: 'Other ways to hand off' }).closest('section')!).getByText(V2)).toBeInTheDocument();

  await expectNoA11yViolations(document.body);
});

test('the options change what will be exported, and leaving out partially indexed items is warned about', async () => {
  await openReady();
  const what = within(screen.getByRole('heading', { name: 'What will be exported' }).closest('section')!);
  await userEvent.click(screen.getByRole('switch', { name: 'Include partially indexed items' }));
  expect(screen.getByRole('switch', { name: 'Include partially indexed items' })).toHaveAttribute('aria-checked', 'false');
  expect(what.getByText('630')).toBeInTheDocument();
  expect(what.getByText('29.0 MB')).toBeInTheDocument();
  expect(what.getByText('630 matching; 25 partially indexed left out')).toBeInTheDocument();
  expect(what.getByRole('alert')).toHaveTextContent("You're leaving out 25 items that couldn't be keyword-searched. Agree this with counsel");

  await userEvent.click(screen.getByRole('switch', { name: 'Include files linked in emails' }));
  await userEvent.click(screen.getByRole('switch', { name: 'Teams conversations as transcripts' }));
  await userEvent.click(within(screen.getByRole('group', { name: 'Format for emails and chats' })).getByRole('button', { name: 'MSG' }));
  expect(screen.getByRole('button', { name: 'MSG' })).toHaveAttribute('aria-pressed', 'true');

  // The choices go to the API with the export.
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toEqual({
    confirm_matter_number: NUMBER,
    accept_changes: false,
    options: { include_partially_indexed: false, partially_indexed_scope: 'responsiveLocations', format: 'msg', include_cloud_attachments: true, teams_transcripts: false },
  });
});

test('the export starts only once the matter number is typed exactly, then shows its progress until Purview has it ready', async () => {
  await openReady();
  expect(startButton()).toBeDisabled();
  await userEvent.type(confirmField(), 'M-2026-014');
  expect(startButton()).toBeDisabled();
  await userEvent.type(confirmField(), '2 '); // a stray space is forgiven
  expect(startButton()).toBeEnabled();
  // Everything the live region says, as it changes.
  const said: string[] = [];
  const region = within(startCard()).getByRole('status');
  const observer = new MutationObserver(() => said.push(region.textContent ?? ''));
  observer.observe(region, { childList: true, subtree: true, characterData: true });
  await userEvent.click(startButton());

  const started = await within(startCard()).findByText(/^Export started at \d\d:\d\d/);
  // It says that the export started once, with its time: not "Export started" first and then again.
  observer.disconnect();
  expect(said.filter(Boolean).every((text) => /^Export started at \d\d:\d\d$/.test(text))).toBe(true);
  // The live region holds the sentence alone, so the percentage isn't read out on every poll.
  const status = within(startCard()).getByRole('status');
  expect(status).toHaveTextContent(/^Export started at \d\d:\d\d$/);
  expect(within(status).queryByRole('progressbar')).not.toBeInTheDocument();
  // The Start button is gone, so focus moves to the sentence that replaced it.
  await waitFor(() => expect(started).toHaveFocus());
  expect(within(startCard()).getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('aria-valuenow', '0');
  expect(within(startCard()).getByRole('link', { name: 'See it in the log' })).toHaveAttribute('href', `/matters/${FALCON}/log`);
  expect(screen.queryByLabelText(/to confirm$/)).not.toBeInTheDocument();
  await waitFor(() => expect(historyRows()).toHaveLength(2));
  expect(historyRows()[0]).toHaveTextContent('Preparing in Purview');
  // The Everlaw steps now name the export being followed, by the name Purview has for it.
  const startedName = within(historyRows()[0]!).getByRole('rowheader').textContent!;
  expect(everlawCard().getByText('SearchTrail is exporting query v3 in Purview as')).toBeInTheDocument();
  expect(everlawCard().getByText(startedName)).toBeInTheDocument();

  tick(4.5);
  await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Export progress' })).toHaveAttribute('aria-valuenow', '50'));
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('50% · usually minutes to hours'));

  tick(10);
  expect(await within(startCard()).findByText('Export ready in Purview')).toBeInTheDocument();
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('Ready in Purview'));

  // The log recorded the start, with the options chosen.
  const log = (await get(`/matters/${FALCON}/log`)).json.items as Schemas['LogEntry'][];
  expect(log.find((e) => e.action === 'export_started')?.details).toMatchObject({ options: OPTIONS, changes_accepted: false });

  // The next export can be set up from the same card, from an empty confirmation, with focus in it.
  await userEvent.click(screen.getByRole('button', { name: 'Set up another export' }));
  expect(confirmField()).toHaveValue('');
  await waitFor(() => expect(confirmField()).toHaveFocus());
  expect(startButton()).toBeDisabled();
  // With the form back, the Everlaw steps describe the export Start would create, not the finished one.
  expect(everlawCard().getByText('SearchTrail starts the export of query v3 in Purview as')).toBeInTheDocument();
  expect(everlawCard().queryByText(startedName)).not.toBeInTheDocument();
});

test('reopening the screen while an export runs shows its progress instead of the form', async () => {
  const job = (await post(`/matters/${FALCON}/exports`, { confirm_matter_number: NUMBER, options: OPTIONS })).json as Schemas['Job'];
  tick(3);
  renderApp(PATH);
  const bar = await screen.findByRole('progressbar', { name: 'Export progress' });
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '33'));
  expect(screen.queryByLabelText(/to confirm$/)).not.toBeInTheDocument();
  tick(10);
  expect(await screen.findByText('Export ready in Purview')).toBeInTheDocument();
  expect((await get(`/jobs/${job.id}`)).json.status).toBe('succeeded');
});

test('blocked: a query that was not previewed cannot be exported, and the screen sends you to Preview', async () => {
  findMatter(FALCON)!.preview = null;
  renderApp(PATH);
  expect(await screen.findByText(/^Query v3 hasn't been previewed/)).toBeInTheDocument();
  const check = within(checkCard());
  expect(check.getByText('Blocked')).toBeInTheDocument();
  expect(check.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
    "Failed: Query v3 hasn't been previewed. Preview it first, so the export matches what was reviewed.",
    'Not checked: Not checked because nothing has been previewed.',
    "Not checked: Not checked because the query wasn't previewed.",
  ]);
  const start = within(startCard());
  expect(start.getByText(/Export blocked: this query hasn't been previewed\./)).toBeInTheDocument();
  expect(start.getByRole('link', { name: 'Go to Preview' })).toHaveAttribute('href', `/matters/${FALCON}/preview`);
  expect(screen.getByText('The counts appear here once the checks have run on a previewed query.')).toBeInTheDocument();

  await userEvent.type(confirmField(), NUMBER);
  expect(startButton()).toBeDisabled();
  await expectNoA11yViolations(document.body);
});

test('blocked: a new matter has no query yet, so the screen says so and sends you to Scope', async () => {
  const created = (await post('/matters', { matter_number: 'M-77', name: 'New', type: 'dsr' })).json as Schemas['Matter'];
  renderApp(`/matters/${created.id}/export`);
  const start = within(await waitFor(() => startCard()));
  expect(await start.findByText("Export blocked: there's no query to export yet.")).toBeInTheDocument();
  expect(within(checkCard()).getAllByRole('listitem')[0]).toHaveTextContent("Failed: There's no query to export yet. Estimate and preview one first.");
  expect(document.body).not.toHaveTextContent('Query v?');
  expect(start.getByRole('link', { name: 'Go to Scope' })).toHaveAttribute('href', `/matters/${created.id}/scope`);
  expect(start.queryByRole('link', { name: 'Go to Preview' })).not.toBeInTheDocument();
});

test('blocked: if the query stops matching the preview after the check, the refused start shows the block', async () => {
  await openReady();
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.type(confirmField(), NUMBER);
  findMatter(FALCON)!.preview = null; // meanwhile, the preview no longer stands
  await userEvent.click(startButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(await within(startCard()).findByText(/Export blocked: this query hasn't been previewed\./)).toBeInTheDocument();
  expect(within(checkCard()).getByText('Blocked')).toBeInTheDocument();
  expect(startButton()).toBeDisabled();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(within(startCard()).getAllByRole('link', { name: 'Go to Preview' })).toHaveLength(1); // said once
});

test('blocked: counts that changed since the preview need an explicit accept, which goes to the API and the log', async () => {
  setScenario({ exportCheck: 'countsChanged' });
  renderApp(PATH);
  expect(await screen.findByText(/^Counts changed since the preview: 630 → 647 items/)).toBeInTheDocument();
  expect(within(checkCard()).getByText('Blocked')).toBeInTheDocument();
  expect(within(checkCard()).getAllByRole('listitem')[2]).toHaveTextContent(/^Failed: Counts changed/);
  // The counts shown are the counts now.
  expect(screen.getByText('630 matching + 25 partially indexed'.replace('630', '647'))).toBeInTheDocument();

  const start = within(startCard());
  expect(start.getByText(/Export blocked: the counts changed since the preview\./)).toBeInTheDocument();
  expect(start.getByRole('link', { name: 'Preview again' })).toHaveAttribute('href', `/matters/${FALCON}/preview`);
  await userEvent.type(confirmField(), NUMBER);
  expect(startButton()).toBeDisabled();

  const accept = start.getByRole('checkbox', { name: /Export with the new counts anyway/ });
  await userEvent.click(accept);
  expect(startButton()).toBeEnabled();
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.click(startButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(bodies[0]).toMatchObject({ accept_changes: true, confirm_matter_number: NUMBER });
  expect(await screen.findByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument();

  const log = (await get(`/matters/${FALCON}/log`)).json.items as Schemas['LogEntry'][];
  expect(log.find((e) => e.action === 'export_started')?.details).toMatchObject({ changes_accepted: true });
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('Count change accepted'));
});

test('blocked: counts that change after a passing check are refused, and the accept appears', async () => {
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  setScenario({ exportCheck: 'countsChanged' }); // new mail arrives
  await userEvent.click(startButton());
  expect(await screen.findByRole('checkbox', { name: /Export with the new counts anyway/ })).not.toBeChecked();
  expect(within(checkCard()).getByText('Blocked')).toBeInTheDocument();
  expect(startButton()).toBeDisabled();
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  // Start is off now, so focus goes to the card's heading, above what it says.
  expect(screen.getByRole('heading', { level: 2, name: 'Start the export' })).toHaveFocus();
});

test('blocked: a matter number the API does not accept is shown at the field', async () => {
  server.use(
    http.post('/api/v1/matters/:matterId/exports', () =>
      HttpResponse.json({ code: 'confirmation_mismatch', message: 'Type the matter number M-2026-0142 exactly to confirm the export.', details: { expected: NUMBER } }, { status: 422 }),
    ),
  );
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  expect(await within(startCard()).findByRole('alert')).toHaveTextContent('Type the matter number M-2026-0142 exactly to confirm the export.');
  // Start was off while it was asked: focus goes to the field the problem is about.
  await waitFor(() => expect(confirmField()).toHaveFocus());
  expect(confirmField()).toHaveAttribute('aria-invalid', 'true');
  expect(confirmField()).toHaveAccessibleDescription('Type the matter number M-2026-0142 exactly to confirm the export.');
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
  // Typing again clears it.
  await userEvent.type(confirmField(), 'x');
  expect(within(startCard()).queryByRole('alert')).not.toBeInTheDocument();
});

test('an export Purview fails is explained, and can be set up again', async () => {
  setScenario({ failJobs: ['export'] });
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  await screen.findByRole('progressbar', { name: 'Export progress' });
  await waitFor(() => expect(within(startCard()).getByText(/^Export started at/)).toHaveFocus());
  tick(10);
  const alert = await within(startCard()).findByRole('alert');
  expect(within(alert).getByRole('heading', { name: "Purview couldn't finish that" })).toBeInTheDocument();
  // The sentence that had focus is gone: focus is on the card's heading, not lost.
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Start the export' })).toHaveFocus());
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('Failed in Purview'));
  await userEvent.click(screen.getByRole('button', { name: 'Set up the export again' }));
  expect(confirmField()).toHaveValue('');
  await waitFor(() => expect(confirmField()).toHaveFocus());
});

test('an export retried after Purview refused it gets a name of its own, so the history never shows two the same', async () => {
  setScenario({ purviewDenied: 'license_missing' });
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  tick(1);
  await within(startCard()).findByRole('alert');
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('Failed in Purview'));
  setScenario({ purviewDenied: false });
  await userEvent.click(screen.getByRole('button', { name: 'Set up the export again' }));
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton()); // a second after the one that failed: the same minute
  await waitFor(() => expect(historyRows()).toHaveLength(3));
  const names = historyRows().map((row) => within(row).getByRole('rowheader').textContent);
  expect(new Set(names).size).toBe(3);
  // As the backend names them: the matter number, EVERLAW and the time to the second.
  expect(names.slice(0, 2)).toEqual(['M-2026-0142 EVERLAW 20261105T120001Z', 'M-2026-0142 EVERLAW 20261105T120000Z']);
});

test('two exports started in the same second still get different names', () => {
  const m = findMatter(FALCON)!;
  const first = exportName(m, '2026-11-05T12:00:00Z');
  expect(first).toBe('M-2026-0142 EVERLAW 20261105T120000Z');
  m.exports.unshift({ ...m.exports[0]!, id: 'exp_same_second', name: first });
  expect(exportName(m, '2026-11-05T12:00:00Z')).toBe(`${first}-2`);
});

/** Long enough for a request the screen might send to have been sent. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 100));

const enterCases: [string, () => void, string][] = [
  ['the query was not previewed', () => void (findMatter(FALCON)!.preview = null), NUMBER],
  ['the counts changed and the accept is not ticked', () => setScenario({ exportCheck: 'countsChanged' }), NUMBER],
  ['the typed number does not match', () => undefined, 'M-2026-014'],
];
test.each(enterCases)('Enter in the confirmation field starts nothing when %s', async (_, arrange, typed) => {
  arrange();
  renderApp(PATH);
  await screen.findByText(/^(Query v3 hasn't been previewed|Counts changed since the preview|Counts unchanged since the preview)/);
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.type(confirmField(), `${typed}{Enter}`);
  await settle();
  expect(bodies).toEqual([]);
  expect(screen.queryByRole('progressbar')).not.toBeInTheDocument();
});

test('an accept is for the counts it was given for: new counts on a later check need a new accept', async () => {
  setScenario({ exportCheck: 'countsChanged' });
  renderApp(PATH);
  await screen.findByText(/^Counts changed since the preview: 630 → 647 items/);
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(screen.getByRole('checkbox', { name: /Export with the new counts anyway/ }));
  expect(startButton()).toBeEnabled();

  // More mail arrives, and the checks run again.
  findMatter(FALCON)!.preview!.counts.items += 5;
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText(/^Counts changed since the preview: 635 → 652 items/)).toBeInTheDocument();
  expect(screen.getByRole('checkbox', { name: /Export with the new counts anyway/ })).not.toBeChecked();
  expect(startButton()).toBeDisabled();
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.type(confirmField(), '{Enter}');
  await settle();
  expect(bodies).toEqual([]);
});

test('while the checks run again, the export cannot start', async () => {
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  expect(startButton()).toBeEnabled();
  let release: () => void = () => undefined;
  const held = new Promise<void>((resolve) => (release = resolve));
  server.use(
    http.post('/api/v1/matters/:matterId/exports/check', async () => {
      await held;
      return HttpResponse.json(exportCheck(findMatter(FALCON)!));
    }),
  );
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(startButton()).toBeDisabled());
  release();
  await waitFor(() => expect(startButton()).toBeEnabled());
});

test('a start refused because another tab started an export follows that one, and the next export starts from a blank confirmation', async () => {
  setScenario({ exportCheck: 'countsChanged' });
  renderApp(PATH);
  await screen.findByText(/^Counts changed since the preview/);
  await userEvent.click(screen.getByRole('checkbox', { name: /Export with the new counts anyway/ }));
  await userEvent.type(confirmField(), NUMBER);

  // Meanwhile, another tab starts an export.
  const other = (await post(`/matters/${FALCON}/exports`, { confirm_matter_number: NUMBER, accept_changes: true, options: OPTIONS })).json as Schemas['Job'];
  await userEvent.click(startButton());
  expect(await screen.findByRole('progressbar', { name: 'Export progress' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/to confirm$/)).not.toBeInTheDocument();
  await waitFor(() => expect(within(startCard()).getByText(/^Export started at/)).toHaveFocus());

  tick(10);
  expect(await within(startCard()).findByText('Export ready in Purview')).toBeInTheDocument();
  expect((await get(`/jobs/${other.id}`)).json.status).toBe('succeeded');

  // Nobody confirmed a next export: the typed number and the accept were for the one that was refused.
  await userEvent.click(screen.getByRole('button', { name: 'Set up another export' }));
  expect(confirmField()).toHaveValue('');
  expect(screen.getByRole('checkbox', { name: /Export with the new counts anyway/ })).not.toBeChecked();
  expect(startButton()).toBeDisabled();
});

test('if the server will not say how a started export is doing, the card says so and can be set up again', async () => {
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'not_found', message: 'No such job.', details: {} }, { status: 404 })));
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  expect(await within(startCard()).findByRole('alert')).toBeInTheDocument();
  expect(within(startCard()).queryByRole('progressbar')).not.toBeInTheDocument();
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Start the export' })).toHaveFocus());
  await userEvent.click(within(startCard()).getByRole('button', { name: 'Set up the export again' }));
  expect(confirmField()).toHaveValue('');
  await waitFor(() => expect(confirmField()).toHaveFocus());
});

test('if the server will not say how a hand-off is doing, it says so and the hand-off can be started again', async () => {
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'not_found', message: 'No such job.', details: {} }, { status: 404 })));
  await openReady();
  const download = within(screen.getByRole('heading', { name: 'Download the package' }).closest('section')!);
  await userEvent.click(download.getByRole('button', { name: 'Download the package' }));
  expect(await download.findByRole('alert')).toBeInTheDocument();
  expect(download.queryByRole('progressbar')).not.toBeInTheDocument();
  expect(download.getByRole('button', { name: /Download/ })).toBeEnabled();
});

test("a hand-off's progress and the review set name belong to the export they were started for", async () => {
  const newest = addV3Export();
  await openReady();
  await waitFor(() => expect(historyRows()).toHaveLength(2));
  const others = () => within(screen.getByRole('heading', { name: 'Other ways to hand off' }).closest('section')!);
  expect(others().getByText(newest.name)).toBeInTheDocument();

  await userEvent.click(others().getByRole('button', { name: 'Download the package' }));
  expect(await others().findByRole('progressbar', { name: 'Downloading the package from Purview' })).toBeInTheDocument();
  const name = others().getByLabelText('Review set name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Falcon newest');

  // Choose the older ready export: its hand-offs show nothing of the newest one's.
  await userEvent.click(screen.getByRole('button', { name: `Details of ${V2}` }));
  await waitFor(() => expect(others().getByText(V2)).toBeInTheDocument());
  expect(others().queryByRole('progressbar')).not.toBeInTheDocument();
  expect(others().getByText('A download of another export is running. This one can start when it ends.')).toBeInTheDocument();
  expect(others().getByRole('button', { name: 'Download the package' })).toBeDisabled();
  expect(others().getByLabelText('Review set name')).toHaveValue('M-2026-0142 Relativity v2');

  // Back on the newest, its download is still shown.
  await userEvent.click(screen.getByRole('button', { name: `Details of ${newest.name}` }));
  expect(await others().findByRole('progressbar', { name: 'Downloading the package from Purview' })).toBeInTheDocument();
  expect(others().getByLabelText('Review set name')).toHaveValue('Falcon newest');
});

test('when Microsoft is throttling, the check says so and can be tried again', async () => {
  setScenario({ throttled: true });
  renderApp(PATH);
  const alert = await within(checkCard()).findByRole('alert');
  expect(within(alert).getByRole('heading', { name: 'Microsoft is limiting requests right now' })).toBeInTheDocument();
  expect(alert).toHaveTextContent('Microsoft is limiting requests right now. Try again in a minute.');
  await userEvent.type(confirmField(), NUMBER);
  expect(startButton()).toBeDisabled(); // nothing was checked

  setScenario({ throttled: false });
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByText(/Counts unchanged since the preview/)).toBeInTheDocument();
  expect(startButton()).toBeEnabled();
});

test('the checks can be run again on request', async () => {
  await openReady();
  let checks = 0;
  server.events.on('request:start', ({ request }) => request.url.endsWith('/exports/check') && (checks += 1));
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(checks).toBe(1));
});

test('download the package: a job with progress, then where it was stored', async () => {
  await openReady();
  const download = within(screen.getByRole('heading', { name: 'Download the package' }).closest('section')!);
  await userEvent.click(download.getByRole('button', { name: 'Download the package' }));
  const bar = await download.findByRole('progressbar', { name: 'Downloading the package from Purview' });
  expect(download.getByRole('status')).toHaveTextContent(/^Downloading the package from Purview$/);
  expect(within(download.getByRole('status')).queryByRole('progressbar')).not.toBeInTheDocument();
  expect(download.getByRole('button', { name: 'Download the package' })).toBeDisabled();
  tick(6);
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '67'));
  tick(5);
  expect(await download.findByText('Package downloaded to SearchTrail: matters/mat_falcon/exports/exp_falcon_v2')).toBeInTheDocument();
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('Package downloaded to SearchTrail'));
  expect(download.getByRole('button', { name: 'Download again' })).toBeEnabled();
});

test('reopening the screen while a download runs shows its progress', async () => {
  await post('/exports/exp_falcon_v2/download');
  tick(3);
  renderApp(PATH);
  const bar = await screen.findByRole('progressbar', { name: 'Downloading the package from Purview' });
  await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '33'));
  // A second start is refused while it runs (the button is off), and it finishes on its own.
  expect(screen.getByRole('button', { name: 'Download the package' })).toBeDisabled();
  tick(10);
  expect(await screen.findByText('Package downloaded to SearchTrail: matters/mat_falcon/exports/exp_falcon_v2')).toBeInTheDocument();
});

test('send to a Purview review set: named, a job with progress, then the set it is in', async () => {
  await openReady();
  const section = within(screen.getByRole('heading', { name: 'Send to a Purview review set (for Relativity)' }).closest('section')!);
  const name = section.getByLabelText('Review set name');
  expect(name).toHaveValue('M-2026-0142 Relativity v2');

  await userEvent.clear(name);
  await userEvent.click(section.getByRole('button', { name: 'Send to review set' }));
  expect(section.getByRole('alert')).toHaveTextContent('Name the review set.');
  expect(name).toHaveAccessibleDescription('Name the review set.');

  const bodies = postedTo('/review-set');
  await userEvent.type(name, 'Falcon for Relativity');
  await userEvent.click(section.getByRole('button', { name: 'Send to review set' }));
  await waitFor(() => expect(bodies).toEqual([{ review_set_name: 'Falcon for Relativity' }]));
  await section.findByRole('progressbar', { name: 'Adding the items to the review set' });
  tick(10);
  expect(await section.findByText('Added to review set Falcon for Relativity')).toBeInTheDocument();
  await waitFor(() => expect(historyRows()[0]).toHaveTextContent('In review set Falcon for Relativity'));
});

test.each([
  ['purview_permission_missing', 'You need a Purview permission for this'],
  ['license_missing', "Purview eDiscovery isn't available for this account"],
] as const)('a hand-off Purview refuses (%s) says why, and starts nothing', async (code, title) => {
  setScenario({ purviewDenied: code });
  await openReady();
  await userEvent.click(screen.getByRole('button', { name: 'Download the package' }));
  const download = within(screen.getByRole('heading', { name: 'Download the package' }).closest('section')!);
  expect(within(await download.findByRole('alert')).getByRole('heading', { name: title })).toBeInTheDocument();
  expect(download.queryByRole('progressbar')).not.toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Send to review set' }));
  const reviewSet = within(screen.getByRole('heading', { name: 'Send to a Purview review set (for Relativity)' }).closest('section')!);
  expect(within(await reviewSet.findByRole('alert')).getByRole('heading', { name: title })).toBeInTheDocument();
});

test('a failed download is explained', async () => {
  setScenario({ failJobs: ['download'] });
  await openReady();
  await userEvent.click(screen.getByRole('button', { name: 'Download the package' }));
  await screen.findByRole('progressbar', { name: 'Downloading the package from Purview' });
  tick(10);
  const download = within(screen.getByRole('heading', { name: 'Download the package' }).closest('section')!);
  expect(within(await download.findByRole('alert')).getByRole('heading', { name: "Purview couldn't finish that" })).toBeInTheDocument();
});

test("an export's details: its files, options and hand-offs, from the export itself", async () => {
  addV3Export({ status: 'preparing', progress: 0.4, finished_at: null, files: [] });
  await openReady();
  await waitFor(() => expect(historyRows()).toHaveLength(2));
  const open = screen.getByRole('button', { name: `Details of ${V2}` });
  await userEvent.click(open);
  expect(open).toHaveAttribute('aria-expanded', 'true');
  const detail = within(await screen.findByRole('heading', { level: 3, name: `Export ${V2}` }).then((h) => h.closest('section')!));
  expect(detail.getByText('Exchange.zip (58.4 MB), SharePoint.zip (30.0 MB)')).toBeInTheDocument();
  expect(detail.getByText(/^Partially indexed items included · PST for emails and chats/)).toBeInTheDocument();
  expect(detail.getByText('Not downloaded')).toBeInTheDocument();
  expect(detail.getByText('Not sent')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);

  // Choosing a ready export also points the other hand-offs at it; a preparing one leaves them on the newest ready.
  await userEvent.click(screen.getByRole('button', { name: `Details of ${V3}` }));
  expect(await screen.findByRole('heading', { level: 3, name: `Export ${V3}` })).toBeInTheDocument();
  // The Everlaw steps name the export being shown.
  expect(everlawCard().getByText('SearchTrail is exporting query v3 in Purview as')).toBeInTheDocument();
  expect(everlawCard().getByText(V3)).toBeInTheDocument();
  expect(screen.queryByRole('heading', { level: 3, name: `Export ${V2}` })).not.toBeInTheDocument();
  expect(within(screen.getByRole('heading', { name: 'Other ways to hand off' }).closest('section')!).getByText(V2)).toBeInTheDocument();
});

test('with no exports yet, the history says so and the hand-offs wait for one', async () => {
  findMatter(FALCON)!.exports = [];
  await openReady();
  expect(await screen.findByText('No exports yet. Start one above once the checks pass.')).toBeInTheDocument();
  expect(screen.getByText('These open once an export is ready in Purview.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Download the package' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Send to review set' })).toBeDisabled();
  expect(screen.getByText(/The name appears here once it has started\./)).toBeInTheDocument();
});

test("the export's name can be copied for Everlaw", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
  await openReady();
  // Opening an export in the list names it in the Everlaw steps.
  await userEvent.click(await screen.findByRole('button', { name: `Details of ${V2}` }));
  expect(everlawCard().getByText('SearchTrail exported query v2 in Purview as')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Copy name' }));
  expect(writeText).toHaveBeenCalledWith(V2);
  expect(await screen.findByRole('button', { name: 'Copied' })).toBeInTheDocument();
});

/** The export check as the mock gives it, changed by `change` (a server whose answers the mock doesn't make). */
function checkAnswers(change: (check: Schemas['ExportCheck']) => Schemas['ExportCheck']) {
  server.use(http.post('/api/v1/matters/:matterId/exports/check', () => HttpResponse.json(change(exportCheck(findMatter(FALCON)!)))));
}
const acceptBox = () => screen.getByRole('checkbox', { name: /Export with the new counts anyway/ });

test('an accept is for the numbers it was shown: the same version previewed again, with the same counts now, needs a new accept', async () => {
  setScenario({ exportCheck: 'countsChanged' });
  renderApp(PATH);
  await screen.findByText(/^Counts changed since the preview: 630 → 647 items/);
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(acceptBox());
  expect(startButton()).toBeEnabled();

  // The same version is previewed again elsewhere and had 640 items then; the counts now are the same 647.
  checkAnswers((check) => ({
    ...check,
    checks: check.checks.map((item) => (item.key === 'counts_unchanged' ? { ...item, message: item.message.replace('630 →', '640 →') } : item)),
  }));
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  expect(await screen.findByText(/^Counts changed since the preview: 640 → 647 items/)).toBeInTheDocument();
  expect(acceptBox()).not.toBeChecked();
  expect(startButton()).toBeDisabled();

  // Accepted again; then only when the preview was made changes.
  await userEvent.click(acceptBox());
  expect(startButton()).toBeEnabled();
  checkAnswers((check) => ({
    ...check,
    previewed_at: '2026-11-05T12:00:00Z',
    checks: check.checks.map((item) => (item.key === 'counts_unchanged' ? { ...item, message: item.message.replace('630 →', '640 →') } : item)),
  }));
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(acceptBox()).not.toBeChecked());
  expect(startButton()).toBeDisabled();
});

test('counts that were not re-checked can still be accepted, for that check only', async () => {
  setScenario({ exportCheck: 'countsChanged' });
  checkAnswers((check) => ({ ...check, counts: null }));
  renderApp(PATH);
  await screen.findByText(/^Counts changed since the preview/);
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(acceptBox());
  expect(acceptBox()).toBeChecked();
  expect(startButton()).toBeEnabled();

  // A later check (it runs at another time) needs a new accept.
  tick(60);
  await userEvent.click(within(checkCard()).getByRole('button', { name: 'Check again' }));
  await waitFor(() => expect(acceptBox()).not.toBeChecked());
  expect(startButton()).toBeDisabled();
});

test('after setting aside an export the server would not say about, a start refused because it still runs shows it again', async () => {
  server.use(http.get('/api/v1/jobs/:jobId', () => HttpResponse.json({ code: 'not_found', message: 'No such job.', details: {} }, { status: 404 })));
  await openReady();
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  await within(startCard()).findByRole('alert');
  await userEvent.click(within(startCard()).getByRole('button', { name: 'Set up the export again' }));

  // It is still running in Purview, so the next start is refused with its id: the card shows it, not a blank form.
  const bodies = postedTo(`/matters/${FALCON}/exports`);
  await userEvent.type(confirmField(), NUMBER);
  await userEvent.click(startButton());
  await waitFor(() => expect(bodies).toHaveLength(1));
  expect(await within(startCard()).findByRole('button', { name: 'Set up the export again' })).toBeInTheDocument();
  expect(screen.queryByLabelText(/to confirm$/)).not.toBeInTheDocument();
});

test("a download found running for one export doesn't show under another whose own download failed earlier", async () => {
  const newest = addV3Export({ download: { status: 'failed', progress: null, stored_path: null, finished_at: null } });
  await post('/exports/exp_falcon_v2/download'); // the older export's download, started elsewhere
  tick(3);
  await openReady();
  await waitFor(() => expect(historyRows()).toHaveLength(2));
  const others = () => within(screen.getByRole('heading', { name: 'Other ways to hand off' }).closest('section')!);
  expect(others().getByText(newest.name)).toBeInTheDocument();
  expect(await others().findByText('A download of another export is running. This one can start when it ends.')).toBeInTheDocument();
  expect(others().queryByRole('progressbar')).not.toBeInTheDocument();

  // Under its own export, it shows.
  await userEvent.click(screen.getByRole('button', { name: `Details of ${V2}` }));
  expect(await others().findByRole('progressbar', { name: 'Downloading the package from Purview' })).toBeInTheDocument();
});

test('formatting: totals, sizes, history items and statuses', () => {
  const counts = { items: 630, size_bytes: 30408704, partial_items: 25, partial_size_bytes: 22754099, mailboxes: 2, sites: 4 };
  expect(exportTotals(counts, true)).toEqual({ items: 655, bytes: 53162803, note: '630 matching + 25 partially indexed' });
  expect(exportTotals(counts, false).items).toBe(630);
  expect([sizeText(500_000), sizeText(30408704), sizeText(3 * 1024 ** 3)]).toEqual(['488 KB', '29.0 MB', '3.0 GB']);
  const now = new Date('2026-11-05T15:00:00');
  expect(whenText('2026-11-05T10:59:00', now)).toBe('Today 10:59');
  expect(whenText('2026-11-04T16:30:00', now)).toBe('Yesterday 16:30');
  expect(whenText('2026-11-01T09:05:00', now)).toBe('1 Nov 09:05');

  const base = {
    id: 'e', matter_id: 'm', name: 'n', version: 2, status: 'ready', progress: 1, counts, changes_accepted: false, started_at: '2026-11-04T16:30:00Z',
    started_by: { id: 'u', display_name: 'Dana' }, finished_at: null, expires_at: null, files: [],
    options: { ...OPTIONS, include_partially_indexed: false } as Schemas['ExportOptions'], download: { status: 'none', progress: null, stored_path: null, finished_at: null },
    review_set: { status: 'none', name: null, finished_at: null },
  } as Schemas['Export'];
  expect(historyItems(base)).toBe('630');
  expect(exportStatus({ ...base, status: 'expired' })).toMatchObject({ label: 'Expired', tone: 'muted' });
  expect(exportStatus({ ...base, status: 'failed', changes_accepted: true }).details).toContain('Count change accepted');
  expect(exportStatus({ ...base, download: { status: 'running', progress: 0.4, stored_path: null, finished_at: null } }).details).toContain('Downloading the package · 40%');
});

test("the screen's styles use the design tokens, not raw colours", async () => {
  const { readFileSync } = await import('node:fs');
  const { resolve } = await import('node:path');
  const css = readFileSync(resolve(__dirname, '../../../src/screens/export/ExportScreen.module.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []).toEqual([]);
  expect(css.match(/\brgba?\(/g) ?? []).toEqual([]);
  const tokens = readFileSync(resolve(__dirname, '../../../src/styles/tokens.css'), 'utf8');
  for (const [, name] of css.matchAll(/var\((--st-[a-z0-9-]+)/g)) expect(tokens).toContain(`${name}:`);
});
