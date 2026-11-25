import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { pollDelay } from '@/api/jobs';
import { setSignInHere } from '@/api/session';
import { example } from '@/mocks/examples';
import { setScenario } from '@/mocks/scenarios';
import { server } from '@/mocks/server';
import {
  checkDomain,
  checkExtension,
  checkTerm,
  displayTerm,
  formatSize,
  labelRows,
  markForms,
  sectionOf,
  sourcesSummary,
  toggleKind,
  withLabelState,
} from '@/screens/scope/criteria';
import { timing } from '@/screens/scope/hooks';
import { expectNoA11yViolations } from '../a11y';
import { requestProblems } from '../contract';
import { FALCON, get, post, put, tick } from '../mocks/api';
import { renderApp } from '../renderApp';

type Criteria = Schemas['Criteria'];
const PATH = `/matters/${FALCON}/scope`;
const FALCON_KQL = example<Schemas['KqlPreview']>('previewKql', '200').kql;
const PUBLIC = '11111111-1111-4111-8111-111111111111';
const CONFIDENTIAL = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  // Short waits, so the tests don't sit through the real debounce and polling. One test puts the debounce back.
  timing.debounceMs = 10;
  timing.pollMs = () => 15;
});
afterEach(() => {
  timing.debounceMs = 300;
  timing.pollMs = pollDelay;
});

/** Record what the screen sends, in order, and check every body against the contract. The real mock still answers. */
function record() {
  const sent = { kql: [] as Criteria[], saves: [] as Criteria[], calls: [] as string[] };
  server.use(
    http.post('/api/v1/kql/preview', async ({ request }) => {
      const body = (await request.clone().json()) as { criteria: Criteria };
      expect(requestProblems('previewKql', body)).toEqual([]);
      sent.kql.push(body.criteria);
      sent.calls.push('kql');
    }),
    http.put('/api/v1/matters/:matterId/draft', async ({ request }) => {
      const body = (await request.clone().json()) as { criteria: Criteria };
      expect(requestProblems('saveDraft', body)).toEqual([]);
      sent.saves.push(body.criteria);
      sent.calls.push('save');
    }),
    http.post('/api/v1/matters/:matterId/estimates', () => {
      sent.calls.push('estimate');
    }),
  );
  return sent;
}

async function openScope() {
  renderApp(PATH);
  await screen.findByText(FALCON_KQL);
}

const region = (name: string) => screen.getByRole('region', { name });
const estimateRegion = () => region('Estimate');

/** A promise to hold a mock answer back until the test lets it go. */
function gate() {
  let open = () => {};
  const shut = new Promise<void>((resolve) => (open = resolve));
  return { shut, open: () => open() };
}

const tab = (name: string) => within(screen.getByRole('navigation', { name: 'Matter sections' })).getByRole('link', { name });
const STALE_DRAFT = example<Schemas['Draft']>('getDraft', '200');

async function addTerm(term: string) {
  await userEvent.type(screen.getByLabelText('Add a term or phrase'), term);
  await userEvent.click(screen.getByRole('button', { name: 'Add term' }));
}

describe('loading', () => {
  test('the saved draft fills every filter, with the KQL and methodology from the API and the latest estimate', async () => {
    const sent = record();
    await openScope();

    expect(screen.getByRole('heading', { level: 2, name: 'Searching 2 custodians and 2 sites' })).toBeInTheDocument();
    expect(screen.getByText(/^Alex Wilber, Megan Bowen · mailboxes, Teams chats and OneDrive · /)).toBeInTheDocument();

    const terms = within(screen.getByRole('list', { name: 'Search terms' })).getAllByRole('listitem');
    expect(terms.map((t) => t.textContent)).toEqual(['"project falcon"', 'invoic*', 'kickback', '"side letter"']);
    expect(within(screen.getByRole('group', { name: 'Match' })).getByRole('button', { name: 'Any term' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('list', { name: 'Exclusion terms' })).getByText('"weekly digest"')).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toHaveValue('2024-01-01');
    expect(screen.getByLabelText('To (inclusive)')).toHaveValue('2025-06-30');
    expect(screen.getByLabelText('Date documents by')).toHaveValue('lastmodifiedtime');
    for (const kind of ['Emails', 'Teams chats', 'Documents']) {
      expect(within(screen.getByRole('group', { name: 'Item types' })).getByRole('button', { name: kind })).toHaveAttribute('aria-pressed', 'true');
    }
    expect(within(screen.getByRole('list', { name: 'File types' })).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['docx', 'xlsx', 'pptx', 'pdf']);
    expect(within(screen.getByRole('list', { name: 'Excluded domains' })).getByText('newsletters.contoso.com')).toBeInTheDocument();

    // Labels come from GET /labels: one row per top-level label, Public excluded as the draft says.
    expect(await screen.findByRole('group', { name: 'Filter for Public' })).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Filter for Public' })).getByRole('button', { name: 'Exclude' })).toHaveAttribute('aria-pressed', 'true');
    expect(within(screen.getByRole('group', { name: 'Filter for Confidential' })).getByRole('button', { name: 'Any' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Includes the Finance and Legal sublabels')).toBeInTheDocument();
    expect(screen.queryByRole('group', { name: 'Filter for Finance' })).not.toBeInTheDocument();

    // The methodology is the API's, with the terms marked.
    const method = region('Culling methodology');
    expect(within(method).getByText(/Excluding items with these sensitivity labels: Public\./)).toBeInTheDocument();
    expect(within(method).getByText('Matter M-2026-0142 · Query v3')).toBeInTheDocument();
    expect(within(method).getByText('invoic*').tagName).toBe('MARK');
    expect(within(region('Purview query (KQL)')).getByText('670 characters.', { exact: false })).toBeInTheDocument();

    // The latest estimate is v3's (from GET .../versions); v3 was previewed.
    const est = within(estimateRegion());
    expect(await est.findByText('630')).toBeInTheDocument();
    expect(est.getByText('items match · 29.0 MB')).toBeInTheDocument();
    expect(est.getByText('25 · 21.7 MB')).toBeInTheDocument();
    expect(est.getByText('2 mailboxes · 4 sites')).toBeInTheDocument();
    expect(est.getByText(/^Estimated .* · v3$/)).toBeInTheDocument();
    expect(est.getByRole('link', { name: 'Open preview' })).toHaveAttribute('href', `/matters/${FALCON}/preview`);
    expect(est.getByRole('link', { name: 'Test terms' })).toHaveAttribute('href', `/matters/${FALCON}/terms`);
    expect(est.queryByRole('button', { name: /^Estimate/ })).not.toBeInTheDocument();

    expect(sent.calls).toEqual(['kql']); // asked for the KQL once, and saved nothing: nothing changed
    await expectNoA11yViolations(document.body);
  });

  test('the KQL on screen is exactly what the API wrote', async () => {
    server.use(
      http.post('/api/v1/kql/preview', () =>
        HttpResponse.json({ kql: 'WRITTEN BY THE SERVER', length: 21, methodology: ['Line one from the server.'], warnings: ['This query is long.'] }),
      ),
    );
    renderApp(PATH);
    expect(await screen.findByText('WRITTEN BY THE SERVER')).toBeInTheDocument();
    expect(screen.getByText('Line one from the server.')).toBeInTheDocument();
    expect(screen.getByText('This query is long.')).toBeInTheDocument();
    expect(screen.getByText(/^21 characters\./)).toBeInTheDocument();
  });

  test('a draft that cannot be loaded says why, with a way to try again', async () => {
    server.use(http.get('/api/v1/matters/:matterId/draft', () => HttpResponse.json({ code: 'internal_error', message: 'The database is busy.', details: {} }, { status: 500 })));
    renderApp(PATH);
    const alert = await screen.findByRole('alert');
    expect(within(alert).getByRole('heading', { level: 3, name: 'Something went wrong on our side' })).toBeInTheDocument();
    expect(within(alert).getByText('The database is busy.')).toBeInTheDocument();
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('a matter not estimated yet offers its first estimate', async () => {
    const matter = { ...example<Schemas['Matter']>('getMatter', '200'), current_version: null, previewed_version: null, last_previewed_at: null };
    server.use(
      http.get('/api/v1/matters/:matterId', () => HttpResponse.json(matter)),
      http.get('/api/v1/matters/:matterId/versions', () => HttpResponse.json({ items: [] })),
    );
    await openScope();
    const est = within(estimateRegion());
    expect(est.getByText(/^Not estimated yet\./)).toBeInTheDocument();
    expect(est.getByRole('button', { name: 'Estimate v1' })).toBeInTheDocument();
    expect(within(region('Culling methodology')).getByText('Matter M-2026-0142 · Query v1 (draft)')).toBeInTheDocument();
  });
});

describe('editing', () => {
  test('an edit asks the API for the KQL, saves the draft, and the screen says the counts are for the old query', async () => {
    const sent = record();
    await openScope();
    await addTerm('brightline');

    expect(within(screen.getByRole('list', { name: 'Search terms' })).getByText('brightline')).toBeInTheDocument();
    await waitFor(() => expect(sent.kql.at(-1)?.keywords).toEqual(['project falcon', 'invoic*', 'kickback', 'side letter', 'brightline']));
    await waitFor(() => expect(sent.saves).toHaveLength(1));
    expect(sent.saves[0]).toEqual(sent.kql.at(-1));
    // The new KQL is the API's answer.
    expect(await screen.findByText(/OR brightline\) AND/)).toBeInTheDocument();
    expect(screen.queryByText(FALCON_KQL)).not.toBeInTheDocument();

    expect(await within(estimateRegion()).findByText('You changed the query.')).toBeInTheDocument();
    expect(within(estimateRegion()).getByText(/These counts are still for v3\./)).toBeInTheDocument();
    expect(within(estimateRegion()).getByRole('button', { name: 'Estimate v4' })).toBeInTheDocument();
    expect(within(estimateRegion()).getByRole('link', { name: 'Preview this query' })).toBeInTheDocument();
    expect(within(region('Culling methodology')).getByText('Matter M-2026-0142 · Query v4 (draft)')).toBeInTheDocument();
    // The header follows the saved draft.
    expect(await screen.findByText('Query v4 · draft')).toBeInTheDocument();
    expect(screen.getByText('Not previewed yet')).toBeInTheDocument();
  });

  test('the KQL is asked for once typing pauses, not on every key (about 300 ms)', async () => {
    timing.debounceMs = 300;
    const sent = record();
    await openScope();
    await userEvent.click(screen.getByText('Expert KQL'));
    await userEvent.type(screen.getByLabelText('Extra query, added with AND'), 'hasattachment:true');
    await waitFor(() => expect(sent.kql.at(-1)?.raw_kql).toBe('hasattachment:true'));
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(sent.kql.map((c) => c.raw_kql)).toEqual([null, 'hasattachment:true']);
    expect(sent.saves.map((c) => c.raw_kql)).toEqual(['hasattachment:true']);
  });

  test('terms that cannot work are refused as they are typed, in plain English', async () => {
    const sent = record();
    await openScope();
    const terms = within(region('Search terms'));
    await addTerm('*voice');
    expect(terms.getByRole('alert')).toHaveTextContent('Leading wildcards are not supported in eDiscovery. Put * at the end of a word.');
    await userEvent.clear(screen.getByLabelText('Add a term or phrase'));
    expect(terms.queryByRole('alert')).not.toBeInTheDocument();
    await addTerm('in*voice');
    expect(terms.getByRole('alert')).toHaveTextContent('A wildcard only works at the end of a single word, like invoic*.');
    await userEvent.clear(screen.getByLabelText('Add a term or phrase'));
    await addTerm('Kickback');
    expect(terms.getByRole('alert')).toHaveTextContent('That term is already in the list.');
    await userEvent.clear(screen.getByLabelText('Add a term or phrase'));
    await addTerm('"wire transfer"');
    expect(terms.queryByRole('alert')).not.toBeInTheDocument();
    expect(terms.getByText('"wire transfer"')).toBeInTheDocument();
    await waitFor(() => expect(sent.saves.at(-1)?.keywords.at(-1)).toBe('wire transfer'));
    expect(sent.saves.flatMap((c) => c.keywords)).not.toContain('*voice');
  });

  test('terms are removed, matched on all of them, and left out', async () => {
    const sent = record();
    await openScope();
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Match' })).getByRole('button', { name: 'All terms' }));
    await userEvent.click(screen.getByRole('button', { name: 'Stop excluding weekly digest' }));
    await userEvent.click(screen.getByRole('button', { name: 'Add exclusion' }));
    const field = screen.getByLabelText('Leave out a term or phrase');
    expect(field).toHaveFocus();
    await userEvent.type(field, 'out of office{Enter}');
    expect(within(screen.getByRole('list', { name: 'Exclusion terms' })).getByText('"out of office"')).toBeInTheDocument();
    await waitFor(() =>
      expect(sent.saves.at(-1)).toMatchObject({ keywords: ['project falcon', 'invoic*', 'side letter'], keyword_mode: 'all', exclude_keywords: ['out of office'] }),
    );
  });

  test('dates, the document date and item types', async () => {
    const sent = record();
    await openScope();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-03-01' } });
    fireEvent.change(screen.getByLabelText('To (inclusive)'), { target: { value: '' } });
    await userEvent.selectOptions(screen.getByLabelText('Date documents by'), 'Created');
    const kinds = within(screen.getByRole('group', { name: 'Item types' }));
    await userEvent.click(kinds.getByRole('button', { name: 'Documents' }));
    expect(kinds.getByRole('button', { name: 'Documents' })).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByText('Turn on Documents to limit file types.')).toBeInTheDocument();
    expect(screen.queryByRole('list', { name: 'File types' })).not.toBeInTheDocument();
    await waitFor(() =>
      expect(sent.saves.at(-1)).toMatchObject({ date_from: '2024-03-01', date_to: null, doc_date_property: 'created', kinds: ['email', 'chats'] }),
    );
    // File types are kept for when Documents is turned back on.
    expect(sent.saves.at(-1)?.file_extensions).toEqual(['docx', 'xlsx', 'pptx', 'pdf']);

    // At least one item type stays on.
    await userEvent.click(kinds.getByRole('button', { name: 'Emails' }));
    await userEvent.click(kinds.getByRole('button', { name: 'Teams chats' }));
    expect(kinds.getByRole('button', { name: 'Teams chats' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Keep at least one item type. Turn another on first.')).toBeInTheDocument();
    expect(screen.queryByText('Turn on Emails or Teams chats to filter by domain.')).not.toBeInTheDocument();
  });

  test('a backwards date range is pointed out', async () => {
    await openScope();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    expect(within(region('Dates and item types')).getByRole('alert')).toHaveTextContent('The From date is after the To date');
  });

  test('a backwards date range cannot be estimated or previewed: Estimate is off, with the reason next to it', async () => {
    const sent = record();
    await openScope();
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2026-01-01' } });
    const reason = 'Estimate is off: the From date is after the To date, so nothing can match. Fix the dates first.';
    // Saved as the person types (work in progress is never lost), and the draft now differs from v3.
    const estimate = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    expect(estimate).toBeDisabled();
    expect(estimate).toHaveAccessibleDescription(reason);
    expect(within(estimateRegion()).getByText(reason)).toBeInTheDocument();
    // Nothing offers to go on with a query that can't match.
    expect(within(estimateRegion()).queryByRole('link', { name: /preview/i })).not.toBeInTheDocument();
    expect(within(estimateRegion()).queryByRole('link', { name: 'Test terms' })).not.toBeInTheDocument();
    // The API agrees (criteria_invalid): no query, no methodology, and the problem is said once, under the dates.
    expect(await within(region('Purview query (KQL)')).findByText("The query can't be built yet. See the message under Dates and item types.")).toBeInTheDocument();
    expect(within(region('Dates and item types')).getAllByRole('alert')).toHaveLength(1);
    await userEvent.click(estimate);
    expect(sent.calls).not.toContain('estimate');
    await expectNoA11yViolations(estimateRegion());

    // Fixing the dates brings Estimate back.
    fireEvent.change(screen.getByLabelText('From'), { target: { value: '2024-03-01' } });
    await waitFor(() => expect(within(estimateRegion()).getByRole('button', { name: 'Estimate v4' })).toBeEnabled());
    expect(within(estimateRegion()).queryByText(reason)).not.toBeInTheDocument();
  });

  test('file types and domains are added and removed', async () => {
    const sent = record();
    await openScope();
    await userEvent.click(screen.getByRole('button', { name: 'Remove pptx' }));
    await userEvent.type(screen.getByLabelText('Add a file type'), '.MSG{Enter}');
    await userEvent.type(screen.getByLabelText('Add a file type'), 'not a type{Enter}');
    expect(screen.getByText('A file type is up to 10 letters and digits, like docx.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Stop excluding newsletters.contoso.com' }));
    await userEvent.type(screen.getByLabelText('Add a domain'), '@Marketing.Contoso.com{Enter}');
    await waitFor(() =>
      expect(sent.saves.at(-1)).toMatchObject({ file_extensions: ['docx', 'xlsx', 'pdf', 'msg'], exclude_participant_domains: ['marketing.contoso.com'] }),
    );
  });

  test('labels are set to Only, Any or Exclude, and Only leaves unlabelled items out', async () => {
    const sent = record();
    await openScope();
    await userEvent.click(within(await screen.findByRole('group', { name: 'Filter for Confidential' })).getByRole('button', { name: 'Only' }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter for Public' })).getByRole('button', { name: 'Any' }));
    expect(screen.getByText(/Items without a sensitivity label are left out, because you chose Only/)).toBeInTheDocument();
    await waitFor(() => expect(sent.saves.at(-1)).toMatchObject({ label_ids: [CONFIDENTIAL], exclude_label_ids: [] }));
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter for Confidential' })).getByRole('button', { name: 'Exclude' }));
    await waitFor(() => expect(sent.saves.at(-1)).toMatchObject({ label_ids: [], exclude_label_ids: [CONFIDENTIAL] }));
    expect(screen.queryByText(/Items without a sensitivity label are left out/)).not.toBeInTheDocument();
  });

  test('Copy KQL copies the API\'s query', async () => {
    const user = userEvent.setup();
    await openScope();
    await user.click(screen.getByRole('button', { name: 'Copy KQL' }));
    expect(await navigator.clipboard.readText()).toBe(FALCON_KQL);
    expect(screen.getByRole('button', { name: 'Copied' })).toBeInTheDocument();
    // A new query can be copied again.
    await addTerm('brightline');
    expect(await screen.findByText(/OR brightline\) AND/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy KQL' })).toBeInTheDocument();
  });

  test('a draft that could not be saved says so, and saves on Try again', async () => {
    let fail = true;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', () =>
        fail ? HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 }) : undefined,
      ),
    );
    await openScope();
    await addTerm('brightline');
    const alert = await screen.findByText('Saving failed.');
    expect(alert.closest('[role="alert"]')).toHaveTextContent('Something went wrong on our side');
    fail = false;
    await userEvent.click(within(alert.closest('[role="alert"]') as HTMLElement).getByRole('button', { name: 'Try again' }));
    const hint = await screen.findByText(/^Changes are saved as you go\. Draft saved /);
    // Saving as you go is not announced; saving again after a failure is.
    expect(hint.closest('[role="status"]')).toBeNull();
    expect(screen.getByText('The draft is saved.').closest('[role="status"]')).not.toBeNull();
  });

  test('ordinary saves are not announced', async () => {
    const sent = record();
    await openScope();
    await addTerm('brightline');
    await waitFor(() => expect(sent.saves).toHaveLength(1));
    const hint = await screen.findByText(/^Changes are saved as you go\. Draft saved /);
    expect(hint.closest('[role="status"]')).toBeNull();
    expect(screen.queryByText('The draft is saved.')).not.toBeInTheDocument();
  });

  test('coming back after the draft changed elsewhere starts from the draft as it is now, not an old copy', async () => {
    await openScope();
    await userEvent.click(tab('Define'));
    await screen.findByRole('heading', { name: 'Matter details' });
    // Another tab saves the draft meanwhile.
    const saved = (await put(`/matters/${FALCON}/draft`, { criteria: { ...STALE_DRAFT.criteria, keywords: ['elsewhere'] } })).json as Schemas['Draft'];
    expect(saved.criteria.keywords).toEqual(['elsewhere']);
    const hold = gate();
    server.use(
      http.get('/api/v1/matters/:matterId/draft', async () => {
        await hold.shut;
      }),
    );
    await userEvent.click(tab('Scope'));
    expect(await screen.findByText('Loading the search…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a term or phrase')).not.toBeInTheDocument();
    hold.open();
    const terms = await screen.findByRole('list', { name: 'Search terms' });
    expect(within(terms).getAllByRole('listitem').map((t) => t.textContent)).toEqual(['elsewhere']);
  });

  test('coming back when the draft cannot be read again says why, instead of starting from the old copy', async () => {
    await openScope();
    await userEvent.click(tab('Define'));
    await screen.findByRole('heading', { name: 'Matter details' });
    let fail = true;
    server.use(
      http.get('/api/v1/matters/:matterId/draft', () =>
        fail ? HttpResponse.json({ code: 'internal_error', message: 'The database is busy.', details: {} }, { status: 500 }) : undefined,
      ),
    );
    await userEvent.click(tab('Scope'));
    const scope = within(screen.getByRole('region', { name: 'Scope' }));
    const alert = await scope.findByRole('alert');
    expect(alert).toHaveTextContent('The database is busy.');
    expect(screen.queryByLabelText('Add a term or phrase')).not.toBeInTheDocument();
    fail = false;
    await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByLabelText('Add a term or phrase')).toBeInTheDocument();
    expect(scope.queryByText('The database is busy.')).not.toBeInTheDocument();
  });

  test('an edit made just before leaving the screen is still saved, and coming back shows it', async () => {
    timing.debounceMs = 300;
    const sent = record();
    const hold = gate();
    server.use(
      http.put('/api/v1/matters/:matterId/draft', async () => {
        await hold.shut; // then the recorder and the mock answer
      }),
    );
    await openScope();
    await addTerm('brightline');
    await userEvent.click(tab('Define')); // well within the 300 ms the screen waits before saving
    await screen.findByRole('heading', { name: 'Matter details' });
    // Back while the save is still on its way: the screen waits for it instead of showing the draft from before.
    await userEvent.click(tab('Scope'));
    expect(await screen.findByText('Loading the search…')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a term or phrase')).not.toBeInTheDocument();
    hold.open();
    await waitFor(() => expect(sent.saves).toHaveLength(1));
    expect(sent.saves[0]?.keywords).toEqual(['project falcon', 'invoic*', 'kickback', 'side letter', 'brightline']);
    expect(await within(await screen.findByRole('list', { name: 'Search terms' })).findByText('brightline')).toBeInTheDocument();
  });
});

describe('criteria_invalid', () => {
  test('the API\'s message is shown under the field it is about, and the query is not shown', async () => {
    server.use(http.post('/api/v1/kql/preview', () => HttpResponse.json(example<Schemas['Error']>('previewKql', '422'), { status: 422 })));
    renderApp(PATH);
    const terms = within(await screen.findByRole('region', { name: 'Search terms' }));
    expect(await terms.findByRole('alert')).toHaveTextContent("Search term '*voice' starts with a wildcard, which Purview doesn't support.");
    const kql = within(region('Purview query (KQL)'));
    expect(kql.getByText("The query can't be built yet. See the message under Search terms.")).toBeInTheDocument();
    expect(kql.getByRole('button', { name: 'Copy KQL' })).toBeDisabled();
    expect(within(region('Culling methodology')).getByText('The methodology appears once the query can be built.')).toBeInTheDocument();
  });

  test('a problem with no field named is shown with the query; fixing it brings the query back', async () => {
    await openScope();
    for (const term of ['project falcon', 'invoic*', 'kickback', 'side letter']) await userEvent.click(screen.getByRole('button', { name: `Remove ${term}` }));
    const kql = within(region('Purview query (KQL)'));
    expect(await kql.findByRole('alert')).toHaveTextContent('Add at least one search term, or a raw KQL query');
    await addTerm('kickback');
    expect(await kql.findByText(/^kickback AND \(\(kind:email/)).toBeInTheDocument();
    expect(kql.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('raw KQL the API rejects opens Expert KQL with the message', async () => {
    server.use(
      http.post('/api/v1/kql/preview', async ({ request }) => {
        const { criteria } = (await request.clone().json()) as { criteria: Criteria };
        if (criteria.raw_kql) {
          const message = criteria.keywords.length > 4 ? 'raw_kql and the terms together are too long.' : 'raw_kql opens a parenthesis it never closes.';
          return HttpResponse.json({ code: 'criteria_invalid', message, details: { field: 'raw_kql' } }, { status: 422 });
        }
      }),
    );
    await openScope();
    await userEvent.click(screen.getByText('Expert KQL'));
    await userEvent.type(screen.getByLabelText('Extra query, added with AND'), '(hasattachment:true');
    const expert = screen.getByText('Expert KQL').closest('details')!;
    expect(await within(expert).findByRole('alert')).toHaveTextContent('raw_kql opens a parenthesis it never closes.');
    expect(expert).toHaveAttribute('open');
    expect(screen.getByLabelText('Extra query, added with AND')).toHaveAttribute('aria-invalid', 'true');
    expect(within(region('Purview query (KQL)')).getByText(/See the message under Expert KQL\./)).toBeInTheDocument();
    // The person can still close it.
    await userEvent.click(screen.getByText('Expert KQL'));
    expect(expert).not.toHaveAttribute('open');
    // A different problem opens it again.
    await addTerm('brightline');
    expect(await within(expert).findByText('raw_kql and the terms together are too long.')).toBeInTheDocument();
    expect(expert).toHaveAttribute('open');
  });

  test('an estimate refused as criteria_invalid sends nothing to Purview and points at the field', async () => {
    server.use(
      http.post('/api/v1/matters/:matterId/estimates', () =>
        HttpResponse.json({ code: 'criteria_invalid', message: 'Domain filters need Emails or Teams chats.', details: { field: 'exclude_participant_domains' } }, { status: 422 }),
      ),
    );
    await openScope();
    await addTerm('brightline');
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    expect(await within(region('Dates and item types')).findByRole('alert')).toHaveTextContent('Domain filters need Emails or Teams chats.');
    expect(within(estimateRegion()).getByText('Nothing was sent to Purview. Fix the problem under Dates and item types, then estimate again.')).toBeInTheDocument();
    // An edit clears it.
    await userEvent.click(screen.getByRole('button', { name: 'Remove brightline' }));
    expect(within(region('Dates and item types')).queryByRole('alert')).not.toBeInTheDocument();
  });
});

describe('estimate', () => {
  test('Estimate runs the estimate, shows its progress with the last counts dimmed, then the new counts', async () => {
    const sent = record();
    await openScope();
    await addTerm('brightline');
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    await waitFor(() => expect(sent.calls.filter((c) => c !== 'kql')).toEqual(['save', 'estimate']));

    const bar = await within(estimateRegion()).findByRole('progressbar', { name: 'Estimate progress' });
    expect(bar).toHaveAttribute('aria-valuenow', '0');
    expect(within(estimateRegion()).getByText(/Purview is counting the items/)).toBeInTheDocument();
    expect(within(estimateRegion()).queryByText('You changed the query.')).not.toBeInTheDocument();
    // v4 has no counts until it is estimated: v3's stay on screen, dimmed, once the header has moved on to v4.
    expect(await screen.findByText('Query v4')).toBeInTheDocument();
    expect(within(estimateRegion()).getByText('630').closest('[data-stale]')).not.toBeNull();
    expect(within(estimateRegion()).getByText(/^Estimated .* · v3$/)).toBeInTheDocument();
    // Those counts are v3's, so nothing offers to go on from them meanwhile.
    expect(within(estimateRegion()).queryByRole('link', { name: 'Preview this query' })).not.toBeInTheDocument();
    expect(within(estimateRegion()).queryByRole('link', { name: 'Test terms' })).not.toBeInTheDocument();
    tick(4.5);
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
    expect(within(estimateRegion()).getByText(/^Estimating · 50%/)).toBeInTheDocument();
    tick(10);
    expect(await within(estimateRegion()).findByText(/^Estimated .* · v4$/)).toBeInTheDocument();
    expect(within(estimateRegion()).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(within(estimateRegion()).queryByText('You changed the query.')).not.toBeInTheDocument();
    expect(within(estimateRegion()).getByRole('link', { name: 'Preview this query' })).toBeInTheDocument(); // v4 isn't previewed
    expect(within(estimateRegion()).getByRole('link', { name: 'Test terms' })).toBeInTheDocument();
    expect(await screen.findByText('Query v4')).toBeInTheDocument(); // the header
    expect(within(region('Culling methodology')).getByText('Matter M-2026-0142 · Query v4')).toBeInTheDocument();
  });

  test('Estimate saves an edit not saved yet first, and the estimate is of that edit', async () => {
    const sent = record();
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }); // the first edit is saved
    timing.debounceMs = 60_000; // the next edit isn't saved by itself in time
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    await userEvent.click(button);
    await waitFor(() => expect(sent.calls.filter((c) => c !== 'kql')).toEqual(['save', 'save', 'estimate']));
    expect(sent.saves[1]?.keywords).toEqual(['project falcon', 'invoic*', 'side letter', 'brightline']);
    expect(await within(estimateRegion()).findByRole('progressbar')).toBeInTheDocument();
  });

  test('when that save fails, no estimate is started and the save\'s notice is the only one', async () => {
    const sent = record();
    let puts = 0;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', () => {
        puts += 1;
        if (puts > 1) return HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 });
      }),
    );
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    timing.debounceMs = 60_000;
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    await userEvent.click(button);
    expect(await screen.findByText('Saving failed.')).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(puts).toBe(2);
    expect(sent.calls).not.toContain('estimate');
    expect(screen.getAllByRole('alert')).toHaveLength(1);
    expect(within(estimateRegion()).getByRole('button', { name: 'Estimate v4' })).toBeEnabled();
  });

  test.each([
    ['lands', false],
    ['fails', true],
  ])('Estimate waits for a save still on its way, and starts only if it %s well', async (_, fails) => {
    const sent = record();
    let hold: ReturnType<typeof gate> | null = null;
    let held = false;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', async () => {
        if (!hold) return;
        held = true;
        await hold.shut;
        if (fails) return HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 });
      }),
    );
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    hold = gate();
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    await waitFor(() => expect(held).toBe(true)); // that edit's save has been sent and not answered
    await userEvent.click(button);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(sent.calls).not.toContain('estimate');
    hold.open();
    if (fails) {
      expect(await screen.findByText('Saving failed.')).toBeInTheDocument();
      await new Promise((resolve) => setTimeout(resolve, 50));
      expect(sent.calls).not.toContain('estimate');
      expect(screen.getAllByRole('alert')).toHaveLength(1);
    } else {
      await waitFor(() => expect(sent.calls.filter((c) => c !== 'kql')).toEqual(['save', 'save', 'estimate']));
      expect(sent.saves[1]?.keywords).toEqual(['project falcon', 'invoic*', 'side letter', 'brightline']);
    }
  });

  test('a save that failed before leaving the screen (and again as it left) does not stop an estimate after coming back', async () => {
    const sent = record();
    let puts = 0;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', () => {
        puts += 1;
        if (puts >= 2) return HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 });
      }),
    );
    await openScope();
    await addTerm('brightline'); // saved
    await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' })); // not saved
    expect(await screen.findByText('Saving failed.')).toBeInTheDocument();
    await userEvent.click(tab('Define'));
    await screen.findByRole('heading', { name: 'Matter details' });
    await waitFor(() => expect(puts).toBe(3)); // leaving tried the unsaved edit once more
    await userEvent.click(tab('Scope'));
    // Back on the draft as saved (with kickback), which is what an estimate is of.
    const terms = await screen.findByRole('list', { name: 'Search terms' });
    expect(within(terms).getByText('kickback')).toBeInTheDocument();
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    expect(await within(estimateRegion()).findByRole('progressbar')).toBeInTheDocument();
    await waitFor(() => expect(sent.calls).toContain('estimate'));
    expect(puts).toBe(3);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  test('an edit made while Estimate waits for a save that then fails does not let the estimate go ahead', async () => {
    const sent = record();
    const hold = gate();
    let puts = 0;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', async () => {
        puts += 1;
        if (puts !== 2) return;
        await hold.shut;
        return HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 });
      }),
    );
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    await waitFor(() => expect(puts).toBe(2)); // that edit's save is on its way
    await userEvent.click(button);
    await userEvent.click(screen.getByRole('button', { name: 'Remove side letter' })); // saved after it
    await new Promise((resolve) => setTimeout(resolve, 50));
    hold.open();
    await waitFor(() => expect(puts).toBe(3)); // the newer edit is saved
    await waitFor(() => expect(sent.saves.at(-1)?.keywords).toEqual(['project falcon', 'invoic*', 'brightline']));
    await new Promise((resolve) => setTimeout(resolve, 50));
    // The save Estimate waited for failed, so nothing was sent to Purview.
    expect(sent.calls).not.toContain('estimate');
    expect(within(estimateRegion()).queryByRole('progressbar')).not.toBeInTheDocument();
    expect(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' })).toBeEnabled();
    // The newer save went through, so its notice is gone; the estimate panel says why nothing happened.
    expect(within(estimateRegion()).getByText('Saving failed.')).toBeInTheDocument();
    expect(screen.getAllByRole('alert')).toHaveLength(1);
  });

  test('after a save failed, Estimate with no new edit saves again, then estimates', async () => {
    const sent = record();
    let puts = 0;
    server.use(
      http.put('/api/v1/matters/:matterId/draft', () => {
        puts += 1;
        sent.calls.push(`put ${puts}`);
        if (puts === 2) return HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 });
      }),
    );
    await openScope();
    await addTerm('brightline');
    await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' }));
    expect(await screen.findByText('Saving failed.')).toBeInTheDocument();
    await userEvent.click(within(estimateRegion()).getByRole('button', { name: 'Estimate v4' }));
    expect(await within(estimateRegion()).findByRole('progressbar')).toBeInTheDocument();
    expect(sent.calls.filter((c) => c.startsWith('put') || c === 'estimate')).toEqual(['put 1', 'put 2', 'put 3', 'estimate']);
    expect(sent.saves.at(-1)?.keywords).toEqual(['project falcon', 'invoic*', 'side letter', 'brightline']);
    expect(screen.queryByText('Saving failed.')).not.toBeInTheDocument();
  });

  test('a draft read that answers late, from before a save, does not undo the save', async () => {
    const sent = record();
    const hold = gate();
    let staleAsked = false;
    let staleAnswered = false;
    let armed = false;
    server.use(
      http.get('/api/v1/matters/:matterId/draft', async () => {
        if (!armed) return;
        armed = false;
        staleAsked = true;
        await hold.shut;
        staleAnswered = true;
        return HttpResponse.json(STALE_DRAFT); // the draft as it was before any edit
      }),
    );
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    armed = true; // the draft is read again once the estimate has started
    await userEvent.click(button);
    await waitFor(() => expect(staleAsked).toBe(true));
    await within(estimateRegion()).findByRole('progressbar');
    await userEvent.click(screen.getByRole('button', { name: 'Remove kickback' })); // saved while that read is on its way
    await waitFor(() => expect(sent.saves).toHaveLength(2));
    expect(await screen.findByText(/^Changes are saved as you go\. Draft saved /)).toBeInTheDocument(); // that save has landed
    expect(await within(region('Culling methodology')).findByText('Matter M-2026-0142 · Query v5 (draft)')).toBeInTheDocument();
    hold.open();
    await waitFor(() => expect(staleAnswered).toBe(true));
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(within(region('Culling methodology')).getByText('Matter M-2026-0142 · Query v5 (draft)')).toBeInTheDocument();
  });

  test('a slow estimate keeps showing its progress, and reopening the screen while it runs picks it up', async () => {
    setScenario({ jobSeconds: 120 });
    await openScope();
    await addTerm('brightline');
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    tick(30);
    await waitFor(() => expect(within(estimateRegion()).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25'));

    cleanup(); // leave the screen, and come back while it still runs
    tick(30);
    renderApp(PATH);
    const bar = await screen.findByRole('progressbar', { name: 'Estimate progress' });
    await waitFor(() => expect(bar).toHaveAttribute('aria-valuenow', '50'));
    expect(screen.getByLabelText('Add a term or phrase')).toBeInTheDocument();
    expect(within(screen.getByRole('list', { name: 'Search terms' })).getByText('brightline')).toBeInTheDocument(); // the saved draft
    expect(within(estimateRegion()).queryByRole('button', { name: /^Estimate v/ })).not.toBeInTheDocument();
    tick(60);
    expect(await within(estimateRegion()).findByText(/^Estimated .* · v4$/)).toBeInTheDocument();
  });

  test('an estimate started elsewhere is followed instead of starting a second one', async () => {
    await openScope();
    await addTerm('brightline');
    const button = await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' });
    await waitFor(() => expect(screen.getByText('Query v4 · draft')).toBeInTheDocument()); // the draft is saved
    const elsewhere = (await post(`/matters/${FALCON}/estimates`)).json as Schemas['Job']; // another tab
    let jobAsked = '';
    server.events.on('request:start', ({ request }) => {
      if (request.url.includes('/jobs/job_')) jobAsked = request.url;
    });
    await userEvent.click(button);
    expect(await within(estimateRegion()).findByRole('progressbar')).toBeInTheDocument();
    expect(within(estimateRegion()).queryByRole('alert')).not.toBeInTheDocument();
    await waitFor(() => expect(jobAsked).toContain(`/jobs/${elsewhere.id}`));
  });

  test('a failed estimate says why, in plain English, with Try again', async () => {
    setScenario({ failJobs: ['estimate'] });
    await openScope();
    await addTerm('brightline');
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    tick(10);
    const alert = await within(estimateRegion()).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: "Purview couldn't finish that" })).toBeInTheDocument();
    expect(alert).toHaveTextContent('Purview stopped the estimate: the search could not be found.');
    expect(within(alert).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
  });

  test('without the Purview role, the labels and the estimate say what is missing', async () => {
    setScenario({ purviewDenied: 'purview_permission_missing' });
    await openScope();
    const labels = within(region('Sensitivity labels'));
    expect(await labels.findByRole('heading', { name: 'You need a Purview permission for this' })).toBeInTheDocument();
    await addTerm('brightline');
    await userEvent.click(await within(estimateRegion()).findByRole('button', { name: 'Estimate v4' }));
    const alert = await within(estimateRegion()).findByRole('alert');
    expect(within(alert).getByRole('heading', { name: 'You need a Purview permission for this' })).toBeInTheDocument();
    expect(alert).toHaveTextContent('eDiscovery Manager role');
    await expectNoA11yViolations(document.body);
  });
});

describe('the screen\'s logic', () => {
  test('terms as typed', () => {
    expect(checkTerm('  ', [])).toBeNull();
    expect(checkTerm('"side letter"', [])).toEqual({ value: 'side letter' });
    expect(checkTerm('wire   transfer', [])).toEqual({ value: 'wire transfer' });
    expect(checkTerm('*voice', [])?.error).toMatch(/^Leading wildcards/);
    expect(checkTerm('two word*', [])?.error).toMatch(/^A wildcard only works/);
    expect(checkTerm('say "hi"', [])?.error).toBe('Leave out quotation marks inside a phrase.');
    expect(checkTerm('INVOIC*', ['invoic*'])?.error).toBe('That term is already in the list.');
    expect(displayTerm('invoic*')).toBe('invoic*');
    expect(displayTerm('side letter')).toBe('"side letter"');
    expect(displayTerm('or')).toBe('"or"');
    expect(markForms(['side letter', 'kickback'])).toEqual(['"side letter"', 'side letter', 'kickback']);
  });

  test('file types and domains as typed', () => {
    expect(checkExtension('.PDF', [])).toEqual({ value: 'pdf' });
    expect(checkExtension('*.docx', ['docx'])?.error).toBe('That file type is already in the list.');
    expect(checkExtension('verylongextension', [])?.error).toMatch(/^A file type/);
    expect(checkDomain('someone@Contoso.com', [])).toEqual({ value: 'contoso.com' });
    expect(checkDomain('contoso', [])?.error).toBe('Enter a domain like newsletters.contoso.com.');
  });

  test('item types keep the contract order and at least one', () => {
    expect(toggleKind(['docs'], 'email')).toEqual(['email', 'docs']);
    expect(toggleKind(['email', 'docs'], 'email')).toEqual(['docs']);
    expect(toggleKind(['docs'], 'docs')).toBeNull();
  });

  test('label rows and states', () => {
    const labels = example<Schemas['LabelList']>('listLabels', '200').items;
    const criteria = example<Schemas['DraftUpdate']>('saveDraft', 'request').criteria;
    const finance = '44444444-4444-4444-8444-444444444444';
    expect(labelRows(labels, criteria).map((r) => [r.name, r.state])).toEqual([
      ['Public', 'exclude'],
      ['General', 'any'],
      ['Confidential', 'any'],
      ['Highly Confidential', 'any'],
    ]);
    // A sublabel the criteria name gets a row of its own, so it can be seen and changed.
    const withFinance = withLabelState(criteria, finance, 'only');
    expect(labelRows(labels, withFinance).map((r) => [r.name, r.state])).toContainEqual(['Confidential/Finance', 'only']);
    const moved = withLabelState(withLabelState(criteria, PUBLIC, 'only'), PUBLIC, 'any');
    expect([moved.label_ids, moved.exclude_label_ids]).toEqual([[], []]);
  });

  test('where an error about a field is shown, sizes, and the sources line', () => {
    expect(['keywords', 'date_to', 'file_extensions', 'exclude_label_ids', 'raw_kql', 'nonsense', undefined].map(sectionOf)).toEqual([
      'terms',
      'dates',
      'types',
      'labels',
      'expert',
      null,
      null,
    ]);
    expect(formatSize(30_408_704)).toBe('29.0 MB');
    expect(formatSize(5 * 1024 ** 3)).toBe('5.0 GB');
    const matter = example<Schemas['Matter']>('getMatter', '200');
    expect(sourcesSummary({ ...matter, custodians: [], sites: [] }).title).toBe('Nothing to search yet');
    expect(sourcesSummary({ ...matter, sites: [] }).title).toBe('Searching 2 custodians and 1 site');
  });
});

describe('when the session ends', () => {
  test('an edit made while signed out stays on screen after signing in again in place, and says it was not saved', async () => {
    setSignInHere(() => setScenario({ sessionExpired: false })); // as the mocks do in the browser
    let draftReads = 0;
    let slow = false;
    server.use(
      http.get('/api/v1/matters/:matterId/draft', async () => {
        draftReads += 1;
        if (slow) await new Promise((resolve) => setTimeout(resolve, 150)); // the read again lands after React renders
      }),
    );
    try {
      await openScope();
      setScenario({ sessionExpired: true });
      const before = draftReads;
      await addTerm('brightline');
      await screen.findByRole('button', { name: 'Sign in' });
      await waitFor(() => expect(draftReads).toBeGreaterThan(before)); // the read after the refused save failed too
      slow = true;
      await userEvent.click(screen.getByRole('button', { name: 'Sign in' }));
      await new Promise((resolve) => setTimeout(resolve, 400));
      const terms = within(await screen.findByRole('list', { name: 'Search terms' })).getAllByRole('listitem');
      expect(terms.map((t) => t.textContent)).toContain('brightline');
      expect(screen.queryByText('Loading the search…')).not.toBeInTheDocument();
      expect(await screen.findByRole('heading', { name: "That didn't go through" })).toBeInTheDocument();
    } finally {
      setSignInHere(null);
    }
  });

  test('back from signing in, the edit that was not saved is said at the top, with focus, and leaving the screen saves it', async () => {
    setSignInHere(() => setScenario({ sessionExpired: false }));
    try {
      await openScope();
      const sent = record();
      setScenario({ sessionExpired: true });
      await addTerm('brightline');
      await userEvent.click(await screen.findByRole('button', { name: 'Sign in' }));
      const heading = await screen.findByRole('heading', { name: "That didn't go through" });
      const notice = heading.closest<HTMLElement>('[role="alert"]')!;
      // Focus moves to it (not to the page's heading), and it sits above the filters, not under the last one.
      await waitFor(() => expect(notice).toHaveFocus());
      expect(notice.compareDocumentPosition(region('Search terms')) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
      expect(within(notice).getByRole('button', { name: 'Try again' })).toBeInTheDocument();
      // The edit is still on screen, and the methodology doesn't pass it off as the saved query version.
      expect(within(screen.getByRole('list', { name: 'Search terms' })).getByText('brightline')).toBeInTheDocument();
      expect(screen.getByText(/Draft \(not saved\)/)).toBeInTheDocument();
      expect(sent.saves).toHaveLength(1); // the one refused

      // Leaving the screen sends it again, now that the session is live.
      await userEvent.click(tab('Define'));
      await screen.findByRole('heading', { name: 'Matter details' });
      await waitFor(() => expect(sent.saves).toHaveLength(2));
      expect(sent.saves[1]?.keywords).toEqual(['project falcon', 'invoic*', 'kickback', 'side letter', 'brightline']);
      await waitFor(async () => expect(((await get(`/matters/${FALCON}/draft`)).json as Schemas['Draft']).criteria.keywords).toContain('brightline'));
    } finally {
      setSignInHere(null);
    }
  });

  test('while an edit is known not to be saved, closing the page asks first', async () => {
    server.use(http.put('/api/v1/matters/:matterId/draft', () => HttpResponse.json({ code: 'internal_error', message: 'Saving failed.', details: {} }, { status: 500 })));
    await openScope();
    const unload = () => {
      const event = new Event('beforeunload', { cancelable: true });
      window.dispatchEvent(event);
      return event.defaultPrevented;
    };
    expect(unload()).toBe(false);
    await addTerm('brightline');
    expect(await screen.findByText('Saving failed.')).toBeInTheDocument();
    expect(unload()).toBe(true);
  });
});
