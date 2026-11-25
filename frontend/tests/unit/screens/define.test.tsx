import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { delay, http, HttpResponse } from 'msw';
import { API_BASE, type Schemas } from '@/api/client';
import { example } from '@/mocks/examples';
import { setScenario } from '@/mocks/scenarios';
import { db, findMatter } from '@/mocks/db';
import { server } from '@/mocks/server';
import { matterView } from '@/mocks/views';
import { holdSummary, holdText, purviewCountText, siteLabel, siteProblem, SITE_DUPLICATE_ERROR, SITE_FORMAT_ERROR } from '@/screens/define/format';
import { timing } from '@/screens/define/hooks';
import { expectNoA11yViolations } from '../a11y';
import { renderApp } from '../renderApp';

const PATH = '/matters/mat_falcon/define';
const ALEX = '3c1a7f5e-0000-4000-8000-0000000000a1';
const HANNAH = '3c1a7f5e-0000-4000-8000-0000000000c3';
const falcon = () => example<Schemas['Matter']>('getMatter', '200');

type Sent = { method: string; path: string; body: unknown };

/** Every write the screen sends, with its JSON body. */
function recordWrites() {
  const sent: Sent[] = [];
  server.events.on('request:start', async ({ request }) => {
    if (request.method === 'GET') return;
    const text = await request.clone().text();
    sent.push({ method: request.method, path: new URL(request.url).pathname.replace('/api/v1', ''), body: text ? JSON.parse(text) : null });
  });
  return sent;
}

async function openDefine() {
  const router = renderApp(PATH);
  await screen.findByRole('heading', { level: 2, name: 'Custodians' });
  return router;
}

const custodianRow = (name: string) => screen.getByRole('group', { name: `Sources to search for ${name}` }).closest('li') as HTMLElement;
const searched = () => screen.getByRole('heading', { name: 'What will be searched' }).closest('section') as HTMLElement;
const countOf = (label: string) => within(searched()).getByText(label).nextElementSibling?.textContent;

/** Remove a custodian: the Remove button, then the confirm step's own button. */
async function removeCustodian(name: string) {
  await userEvent.click(screen.getByRole('button', { name: `Remove ${name}` }));
  await userEvent.click(within(screen.getByRole('group', { name: `Remove ${name} from this matter?` })).getByRole('button', { name: 'Remove from matter' }));
}
/** Release a custodian's hold: the switch, then the confirm step's own button. */
async function releaseHold(name: string) {
  await userEvent.click(screen.getByRole('switch', { name: `Legal hold for ${name}` }));
  await userEvent.click(within(screen.getByRole('group', { name: `Release the legal hold on ${name}?` })).getByRole('button', { name: 'Release hold' }));
}

beforeEach(() => {
  timing.holdPollMs = 30;
  timing.searchDebounceMs = 20;
});
/** Requests a test is holding back, let go after each test so a failed one can't leave them waiting. */
const heldRequests: (() => void)[] = [];
afterEach(() => {
  heldRequests.splice(0).forEach((release) => release());
  timing.holdPollMs = 3000;
  timing.searchDebounceMs = 300;
});

test("the screen shows the matter's details, custodians, sites and what will be searched", async () => {
  await openDefine();
  expect(screen.getByLabelText('Matter ID')).toHaveValue('M-2026-0142');
  expect(screen.getByLabelText('Matter type')).toHaveValue('investigation');
  expect(screen.getByLabelText('Name')).toHaveValue('Project Falcon investigation');
  expect(screen.getByLabelText('Description')).toHaveValue('Internal investigation into supplier payments linked to Project Falcon.');

  const alex = custodianRow('Alex Wilber');
  expect(within(alex).getByText('alex.wilber@contoso.com · Procurement')).toBeInTheDocument();
  expect(within(alex).getByRole('button', { name: 'Mailbox and Teams chats' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(alex).getByText('Not on hold')).toBeInTheDocument();
  expect(within(alex).getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toHaveAttribute('aria-checked', 'false');
  const megan = custodianRow('Megan Bowen');
  expect(within(megan).getByText(/^On hold since \d+ Nov$/)).toBeInTheDocument();
  expect(within(megan).getByRole('switch', { name: 'Legal hold for Megan Bowen' })).toHaveAttribute('aria-checked', 'true');
  expect(within(megan).getByRole('list', { name: 'Sites linked to Megan Bowen' })).toHaveTextContent('sites/ProjectFalcon');

  expect(within(screen.getByRole('list', { name: 'Sites without a custodian' })).getByText('https://contoso.sharepoint.com/sites/Finance')).toBeInTheDocument();
  expect(countOf('Mailboxes, with Teams chats')).toBe('2');
  expect(countOf('OneDrive accounts')).toBe('2');
  expect(countOf('SharePoint sites')).toBe('2');
  expect(within(searched()).getByText('Purview counts OneDrive accounts as sites, so estimates will show 2 mailboxes and 4 sites.')).toBeInTheDocument();
  expect(within(searched()).getByText('In step with the Purview case')).toBeInTheDocument();
  expect(within(searched()).getByRole('link', { name: 'Continue to Scope' })).toHaveAttribute('href', '/matters/mat_falcon/scope');
  expect(screen.getByText('1 of 2 custodians on hold')).toBeInTheDocument();
  expect(screen.getByLabelText('Add a custodian from Contoso Ltd\'s directory')).toBeInTheDocument();
  expect(screen.getByRole('link', { name: /^Open in Purview ?\(opens in a new tab\)$/ })).toHaveAttribute('target', '_blank');
  await expectNoA11yViolations(document.body);
});

test('details are saved when a field is left, and the header follows', async () => {
  const sent = recordWrites();
  await openDefine();
  const name = screen.getByLabelText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Project Falcon (supplier payments)');
  await userEvent.tab();
  expect(await screen.findByRole('heading', { level: 1, name: 'Project Falcon (supplier payments)' })).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Matter type'), 'Litigation');
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent).toEqual([
    { method: 'PATCH', path: '/matters/mat_falcon', body: { name: 'Project Falcon (supplier payments)' } },
    { method: 'PATCH', path: '/matters/mat_falcon', body: { type: 'litigation' } },
  ]);
  expect(await screen.findByText('Saved')).toBeInTheDocument();
});

test('an empty name is not saved', async () => {
  const sent = recordWrites();
  await openDefine();
  await userEvent.clear(screen.getByLabelText('Name'));
  await userEvent.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent('Enter a name for the matter.');
  expect(screen.getByLabelText('Name')).toHaveAttribute('aria-invalid', 'true');
  expect(screen.getByLabelText('Name')).toHaveAccessibleDescription('Enter a name for the matter.');
  expect(sent).toEqual([]);
});

test('a refused detail change is shown under the field', async () => {
  server.use(http.patch('/api/v1/matters/:matterId', () => HttpResponse.json({ code: 'validation_failed', message: 'description must be at most 2000 characters.', details: {} }, { status: 400 })));
  await openDefine();
  await userEvent.type(screen.getByLabelText('Description'), ' More.');
  await userEvent.tab();
  expect(await screen.findByRole('alert')).toHaveTextContent("That isn't valid. description must be at most 2000 characters.");
  const description = screen.getByLabelText('Description');
  expect(description).toHaveAttribute('aria-invalid', 'true');
  expect(description).toHaveAccessibleDescription(
    "Shown on the Purview case and at the top of the methodology report. That isn't valid. description must be at most 2000 characters.",
  );
});

test('a refused type change goes back to the saved type', async () => {
  server.use(http.patch('/api/v1/matters/:matterId', () => HttpResponse.json({ code: 'validation_failed', message: 'type is not allowed.', details: {} }, { status: 400 })));
  await openDefine();
  const type = screen.getByLabelText('Matter type');
  await userEvent.selectOptions(type, 'Litigation');
  expect(await screen.findByRole('alert')).toHaveTextContent("That isn't valid. type is not allowed.");
  expect(type).toHaveValue('investigation');
  expect(type).toHaveAttribute('aria-invalid', 'true');
  expect(type).toHaveAccessibleDescription("That isn't valid. type is not allowed.");
});

test('a type change refused after another detail was saved still goes back to the saved type', async () => {
  let answerType = () => {};
  const typeAnswered = new Promise<void>((resolve) => (answerType = resolve));
  heldRequests.push(() => answerType());
  server.use(
    http.patch('/api/v1/matters/:matterId', async ({ request }) => {
      const body = (await request.clone().json()) as Schemas['MatterUpdate'];
      if (body.type === undefined) return undefined; // the mock's own handler
      await typeAnswered; // refused only once the description has been saved
      return HttpResponse.json({ code: 'validation_failed', message: 'type is not allowed.', details: {} }, { status: 400 });
    }),
  );
  await openDefine();
  const type = screen.getByLabelText('Matter type');
  await userEvent.selectOptions(type, 'Litigation');
  await userEvent.type(screen.getByLabelText('Description'), ' More.');
  await userEvent.tab();
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  expect(type).toHaveValue('litigation');
  answerType();
  await waitFor(() => expect(type).toHaveValue('investigation'));
});

test('"Saved" goes once the details are edited again', async () => {
  await openDefine();
  await userEvent.type(screen.getByLabelText('Description'), ' More.');
  await userEvent.tab();
  expect(await screen.findByText('Saved')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText('Name'), '!');
  expect(screen.queryByText('Saved')).not.toBeInTheDocument();
});

test('finding a person and adding them makes the next search a new version', async () => {
  const sent = recordWrites();
  await openDefine();
  await userEvent.type(screen.getByLabelText(/Add a custodian/), 'fin');
  const list = await screen.findByRole('list', { name: 'Matching people' });
  // Megan Bowen is in Finance too, but already a custodian.
  const hannah = await within(list).findByRole('button', { name: /Hannah Ortega/ });
  expect(within(list).queryByRole('button', { name: /Megan Bowen/ })).not.toBeInTheDocument();
  await expectNoA11yViolations(document.body);
  await userEvent.click(hannah);

  expect(screen.getByLabelText(/Add a custodian/)).toHaveValue('');
  expect(screen.getByLabelText(/Add a custodian/)).toHaveFocus();
  expect(custodianRow('Hannah Ortega')).toBeInTheDocument();
  await waitFor(() => expect(sent).toEqual([{ method: 'PUT', path: `/matters/mat_falcon/custodians/${HANNAH}`, body: { mailbox: true, onedrive: true, sites: [] } }]));
  // The header and the summary say the sources changed and the preview no longer applies.
  expect(await screen.findByText('Query v4 · draft')).toBeInTheDocument();
  expect(screen.getByText('Not previewed yet')).toBeInTheDocument();
  expect(screen.getByText(/^Purview case M-2026-0142 · 3 custodians · /)).toBeInTheDocument();
  const notice = (await within(searched()).findByText('Who is searched has changed.')).closest('[role="status"]');
  expect(notice).toHaveTextContent("SearchTrail will create search v4 in Purview. The v3 preview no longer applies, so you'll need to preview again before exporting.");
  expect(countOf('Mailboxes, with Teams chats')).toBe('3');
  await expectNoA11yViolations(document.body);
});

test('the people search waits for two letters, and says when no one matches', async () => {
  await openDefine();
  const input = screen.getByLabelText(/Add a custodian/);
  await userEvent.type(input, 'z');
  expect(screen.getByRole('list', { name: 'Matching people' })).toHaveTextContent('Keep typing: search needs at least two letters.');
  await userEvent.type(input, 'zz');
  expect(await screen.findByText('No one in the directory matches. Check the spelling, or add a site instead.')).toBeInTheDocument();
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('list', { name: 'Matching people' })).not.toBeInTheDocument();
});

test('the people search is debounced: typing quickly asks the directory once', async () => {
  timing.searchDebounceMs = 150;
  const asked: string[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (url.pathname.endsWith('/directory/users')) asked.push(url.searchParams.get('q') ?? '');
  });
  await openDefine();
  await userEvent.type(screen.getByLabelText(/Add a custodian/), 'grace');
  expect(await screen.findByRole('button', { name: /Grace Okafor/ })).toBeInTheDocument();
  expect(asked).toEqual(['grace']);
});

test('when Microsoft throttles the directory search, the screen says so and can try again', async () => {
  setScenario({ throttled: true });
  await openDefine();
  await userEvent.type(screen.getByLabelText(/Add a custodian/), 'han');
  const list = await screen.findByRole('list', { name: 'Matching people' });
  expect(await within(list).findByRole('alert')).toHaveTextContent(/^Microsoft is limiting requests right now\. Try again in a minute\.$/);
  setScenario({ throttled: false });
  await userEvent.click(within(list).getByRole('button', { name: 'Try again' }));
  expect(await within(list).findByRole('button', { name: /Hannah Ortega/ })).toBeInTheDocument();
});

test("turning a source off saves it and changes what's searched", async () => {
  const sent = recordWrites();
  await openDefine();
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' }));
  expect(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' })).toHaveAttribute('aria-pressed', 'false');
  expect(countOf('OneDrive accounts')).toBe('1');
  await waitFor(() => expect(sent).toEqual([{ method: 'PUT', path: `/matters/mat_falcon/custodians/${ALEX}`, body: { mailbox: true, onedrive: false, sites: [] } }]));
  expect(await screen.findByText('Query v4 · draft')).toBeInTheDocument();
});

test('a custodian with nothing to search is held back with a warning until a source is chosen again', async () => {
  const sent = recordWrites();
  await openDefine();
  const row = () => custodianRow('Alex Wilber');
  await userEvent.click(within(row()).getByRole('button', { name: 'OneDrive' }));
  await waitFor(() => expect(sent).toHaveLength(1));
  await userEvent.click(within(row()).getByRole('button', { name: 'Mailbox and Teams chats' }));
  expect(within(row()).getByRole('alert')).toHaveTextContent('Nothing selected for Alex Wilber. Choose at least one source, or remove them.');
  expect(countOf('Mailboxes, with Teams chats')).toBe('1');
  await expectNoA11yViolations(document.body);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(sent).toHaveLength(1); // the API needs at least one source, so nothing was sent
  await userEvent.click(within(row()).getByRole('button', { name: 'Mailbox and Teams chats' }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]).toEqual({ method: 'PUT', path: `/matters/mat_falcon/custodians/${ALEX}`, body: { mailbox: true, onedrive: false, sites: [] } });
  expect(within(row()).queryByRole('alert')).not.toBeInTheDocument();
});

test('a refused source change is put back and explained', async () => {
  server.use(http.put('/api/v1/matters/:matterId/custodians/:userId', () => HttpResponse.json({ code: 'internal_error', message: 'Something broke.', details: {} }, { status: 500 })));
  await openDefine();
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' }));
  expect(await within(custodianRow('Alex Wilber')).findByRole('alert')).toHaveTextContent('Something went wrong on our side. Something broke.');
  expect(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' })).toHaveAttribute('aria-pressed', 'true');
  expect(countOf('OneDrive accounts')).toBe('2');
});

/** Answer removals of a custodian after a moment, as a real API would, so their row has gone by then. */
function slowRemovals() {
  server.use(
    http.delete('/api/v1/matters/:matterId/custodians/:userId', async () => {
      await delay(50);
      return undefined; // the mock's own handler
    }),
  );
}

test('a custodian can be removed, but not while on hold', async () => {
  slowRemovals(); // the row has gone by the time the API answers, and comes back when refused
  const sent = recordWrites();
  await openDefine();
  await removeCustodian('Alex Wilber');
  await waitFor(() => expect(screen.queryByText('alex.wilber@contoso.com · Procurement')).not.toBeInTheDocument());
  // Focus goes to the next custodian's remove button.
  expect(screen.getByRole('button', { name: 'Remove Megan Bowen' })).toHaveFocus();
  await waitFor(() => expect(sent).toEqual([{ method: 'DELETE', path: `/matters/mat_falcon/custodians/${ALEX}`, body: null }]));

  await removeCustodian('Megan Bowen');
  // No one is left below or above, so focus goes to the section's heading.
  await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Custodians' })).toHaveFocus());
  expect(await screen.findByText('Megan Bowen is on hold. Release the hold before removing them.')).toBeInTheDocument();
  expect(within(custodianRow('Megan Bowen')).getByRole('alert')).toHaveTextContent('Megan Bowen is on hold. Release the hold before removing them.');
  expect(screen.getByText('megan.bowen@contoso.com · Finance')).toBeInTheDocument();
  await expectNoA11yViolations(document.body);
});

test('removing a custodian asks first, says what it does, and Cancel or Escape changes nothing and puts focus back', async () => {
  const sent = recordWrites();
  await openDefine();
  const remove = screen.getByRole('button', { name: 'Remove Alex Wilber' });
  await userEvent.click(remove);
  const confirm = screen.getByRole('group', { name: 'Remove Alex Wilber from this matter?' });
  expect(confirm).toHaveAccessibleDescription(/^Their mailbox, Teams chats, OneDrive and linked sites won't be searched any more\./);
  expect(remove).toHaveAttribute('aria-expanded', 'true');
  // Cancel has focus, so a stray Enter does nothing harmful.
  expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await expectNoA11yViolations(document.body);
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('group', { name: 'Remove Alex Wilber from this matter?' })).not.toBeInTheDocument();
  expect(remove).toHaveFocus();

  await userEvent.click(remove);
  await userEvent.keyboard('{Escape}');
  expect(screen.queryByRole('group', { name: 'Remove Alex Wilber from this matter?' })).not.toBeInTheDocument();
  expect(remove).toHaveFocus();
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(sent).toEqual([]);
  expect(screen.getByText('alex.wilber@contoso.com · Procurement')).toBeInTheDocument();

  // Someone on hold: the step says the hold has to be released first.
  await userEvent.click(screen.getByRole('button', { name: 'Remove Megan Bowen' }));
  expect(screen.getByRole('group', { name: 'Remove Megan Bowen from this matter?' })).toHaveAccessibleDescription(
    /They are on legal hold: release the hold first, or the removal is refused\.$/,
  );
});

test('releasing a hold asks first and says what it means; Cancel keeps the hold and puts focus back on the switch', async () => {
  const sent = recordWrites();
  await openDefine();
  const holdSwitch = screen.getByRole('switch', { name: 'Legal hold for Megan Bowen' });
  await userEvent.click(holdSwitch);
  const confirm = screen.getByRole('group', { name: 'Release the legal hold on Megan Bowen?' });
  expect(confirm).toHaveAccessibleDescription(/so anything deleted from them from now on can be lost for good\. The release is recorded in the log\.$/);
  expect(holdSwitch).toHaveAttribute('aria-checked', 'true');
  expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus();
  await expectNoA11yViolations(document.body);
  await userEvent.click(within(confirm).getByRole('button', { name: 'Cancel' }));
  expect(holdSwitch).toHaveFocus();
  expect(holdSwitch).toHaveAttribute('aria-checked', 'true');
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(sent).toEqual([]);

  // The confirm button sends the release.
  await releaseHold('Megan Bowen');
  await waitFor(() => expect(sent).toEqual([{ method: 'PUT', path: expect.stringMatching(/\/custodians\/.+\/hold$/), body: { on_hold: false } }]));
  // The switch waits for Purview, so focus goes to the hold's status beside it.
  await waitFor(() => expect(within(custodianRow('Megan Bowen')).getByText('Release requested')).toHaveFocus());
});

test('placing a hold needs no confirm step', async () => {
  await openDefine();
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(screen.queryByRole('group', { name: /legal hold on Alex Wilber/ })).not.toBeInTheDocument();
  expect(await within(custodianRow('Alex Wilber')).findByText('Hold requested')).toBeInTheDocument();
});

test('a refusal to remove someone on hold goes once their hold is released', async () => {
  const purview = slowPurview();
  await openDefine();
  await removeCustodian('Megan Bowen');
  const refusal = 'Megan Bowen is on hold. Release the hold before removing them.';
  expect(await within(custodianRow('Megan Bowen')).findByText(refusal)).toBeInTheDocument();
  await releaseHold('Megan Bowen');
  expect(await within(custodianRow('Megan Bowen')).findByText('Release requested')).toBeInTheDocument();
  expect(within(custodianRow('Megan Bowen')).queryByText(refusal)).not.toBeInTheDocument();
  purview.purviewDone = true;
});

test('sources held back for a removed custodian are not brought back when they are added again', async () => {
  slowRemovals();
  await openDefine();
  const row = () => custodianRow('Alex Wilber');
  await userEvent.click(within(row()).getByRole('button', { name: 'OneDrive' }));
  await userEvent.click(within(row()).getByRole('button', { name: 'Mailbox and Teams chats' }));
  expect(within(row()).getByRole('alert')).toHaveTextContent('Nothing selected for Alex Wilber.');
  await removeCustodian('Alex Wilber');
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Sources to search for Alex Wilber' })).not.toBeInTheDocument());
  await waitFor(() => expect(findMatter('mat_falcon')!.matter.custodians.some((c) => c.user_id === ALEX)).toBe(false));

  await userEvent.type(screen.getByLabelText(/Add a custodian/), 'alex');
  await userEvent.click(await screen.findByRole('button', { name: /Alex Wilber/ }));
  await waitFor(() => expect(findMatter('mat_falcon')!.matter.custodians.some((c) => c.user_id === ALEX)).toBe(true));
  expect(within(row()).getByRole('button', { name: 'Mailbox and Teams chats' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(row()).getByRole('button', { name: 'OneDrive' })).toHaveAttribute('aria-pressed', 'true');
  expect(within(row()).queryByRole('alert')).not.toBeInTheDocument();
});

test('changes to who is searched are sent one at a time, in order', async () => {
  // The first change is answered slowly; sent side by side, the second would land first and be overwritten.
  let calls = 0;
  let open = 0;
  let mostOpen = 0;
  server.use(
    http.put('/api/v1/matters/:matterId/custodians/:userId', async () => {
      calls += 1;
      open += 1;
      mostOpen = Math.max(mostOpen, open);
      if (calls === 1) await delay(150);
      open -= 1;
      return undefined; // the mock's own handler
    }),
  );
  await openDefine();
  const oneDrive = () => within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' });
  await userEvent.click(oneDrive());
  await userEvent.click(oneDrive());
  await waitFor(() => expect(calls).toBe(2));
  await waitFor(() => expect(findMatter('mat_falcon')!.matter.custodians.find((c) => c.user_id === ALEX)!.onedrive).toBe(true));
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(mostOpen).toBe(1);
  expect(findMatter('mat_falcon')!.matter.custodians.find((c) => c.user_id === ALEX)!.onedrive).toBe(true);
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'true');
});

/**
 * Reads of the matter that take a moment and answer with the matter as it was when they were asked, without
 * settling holds. Resolves `started` once a read is under way.
 */
function slowStaleReads() {
  let started = () => {};
  const readStarted = new Promise<void>((resolve) => (started = resolve));
  server.use(
    http.get('/api/v1/matters/:matterId', async ({ params }) => {
      const asAsked = matterView(db.matters.find((x) => x.matter.id === params.matterId)!);
      started();
      await delay(150);
      return HttpResponse.json(asAsked);
    }),
  );
  return readStarted;
}

test("a hold's answer is not undone by a read of the matter that was already under way", async () => {
  await openDefine();
  const read = slowStaleReads();
  // A saved source change reads the matter again.
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' }));
  await read;
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(await within(custodianRow('Alex Wilber')).findByText('Hold requested')).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(within(custodianRow('Alex Wilber')).getByText('Hold requested')).toBeInTheDocument();
});

test("a detail's answer is not undone by a read of the matter that was already under way", async () => {
  await openDefine();
  const read = slowStaleReads();
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' }));
  await read;
  const name = screen.getByLabelText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Falcon');
  await userEvent.tab();
  expect(await screen.findByRole('heading', { level: 1, name: 'Falcon' })).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 250));
  expect(screen.getByRole('heading', { level: 1, name: 'Falcon' })).toBeInTheDocument();
});

/** While `hold.purviewDone` is false, the matter is read without Purview finishing any hold change (the mock settles one on every read). */
function slowPurview() {
  const hold = { purviewDone: false };
  server.use(
    http.get('/api/v1/matters/:matterId', ({ params }) => {
      if (hold.purviewDone) return undefined; // the mock's own handler, which settles the change
      const m = db.matters.find((x) => x.matter.id === params.matterId)!;
      return HttpResponse.json(matterView(m));
    }),
  );
  return hold;
}

/** Changes to a custodian's sources wait until `answer()` is called, so other answers can come back meanwhile. */
function heldSourceChanges() {
  let answer = () => {};
  const answered = new Promise<void>((resolve) => (answer = resolve));
  heldRequests.push(() => answer());
  server.use(
    http.put('/api/v1/matters/:matterId/custodians/:userId', async () => {
      await answered;
      return undefined; // the mock's own handler
    }),
  );
  return { answer: () => answer() };
}

test("a detail's answer doesn't undo a change to who is searched that is still waiting", async () => {
  const sources = heldSourceChanges();
  await openDefine();
  const oneDrive = () => within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' });
  await userEvent.click(oneDrive());
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
  const name = screen.getByLabelText('Name');
  await userEvent.clear(name);
  await userEvent.type(name, 'Falcon');
  await userEvent.tab();
  expect(await screen.findByRole('heading', { level: 1, name: 'Falcon' })).toBeInTheDocument();
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
  expect(countOf('OneDrive accounts')).toBe('1');
  sources.answer();
  await waitFor(() => expect(findMatter('mat_falcon')!.matter.custodians.find((c) => c.user_id === ALEX)!.onedrive).toBe(false));
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
  expect(screen.getByRole('heading', { level: 1, name: 'Falcon' })).toBeInTheDocument();
});

test("a hold's answer doesn't undo a change to that person's sources that is still waiting", async () => {
  const sources = heldSourceChanges();
  const purview = slowPurview();
  await openDefine();
  const oneDrive = () => within(custodianRow('Alex Wilber')).getByRole('button', { name: 'OneDrive' });
  await userEvent.click(oneDrive());
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(await within(custodianRow('Alex Wilber')).findByText('Hold requested')).toBeInTheDocument();
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
  // Reads while the hold settles don't bring the old sources back either.
  await new Promise((resolve) => setTimeout(resolve, 100));
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
  sources.answer();
  await waitFor(() => expect(findMatter('mat_falcon')!.matter.custodians.find((c) => c.user_id === ALEX)!.onedrive).toBe(false));
  purview.purviewDone = true;
  expect(await within(custodianRow('Alex Wilber')).findByText(/^On hold since /)).toBeInTheDocument();
  expect(oneDrive()).toHaveAttribute('aria-pressed', 'false');
});

test('a hold shows as requested until Purview reports it on', async () => {
  const sent = recordWrites();
  const purview = slowPurview();
  await openDefine();
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(await within(custodianRow('Alex Wilber')).findByText('Hold requested')).toBeInTheDocument();
  const alexSwitch = screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' });
  expect(alexSwitch).toHaveAttribute('aria-checked', 'true');
  expect(alexSwitch).toBeDisabled();
  expect(screen.getByText('1 of 2 custodians on hold · 1 being placed')).toBeInTheDocument();
  await new Promise((resolve) => setTimeout(resolve, 100)); // a few reads go by: still pending
  expect(within(custodianRow('Alex Wilber')).getByText('Hold requested')).toBeInTheDocument();

  purview.purviewDone = true;
  expect(await within(custodianRow('Alex Wilber')).findByText(/^On hold since /)).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toBeEnabled();
  expect(screen.getByText('2 of 2 custodians on hold')).toBeInTheDocument();
  expect(sent).toEqual([{ method: 'PUT', path: `/matters/mat_falcon/custodians/${ALEX}/hold`, body: { on_hold: true } }]);
});

test('releasing a hold shows as such until Purview has released it', async () => {
  const purview = slowPurview();
  await openDefine();
  await releaseHold('Megan Bowen');
  expect(await within(custodianRow('Megan Bowen')).findByText('Release requested')).toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'Legal hold for Megan Bowen' })).toBeDisabled();
  purview.purviewDone = true;
  expect(await within(custodianRow('Megan Bowen')).findByText('Not on hold')).toBeInTheDocument();
  expect(screen.getByText('No custodians on hold')).toBeInTheDocument();
});

test('reopening the screen while a hold is being placed carries on until it is on', async () => {
  const purview = slowPurview();
  await fetch(`${API_BASE}/matters/mat_falcon/custodians/${ALEX}/hold`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ on_hold: true }) });
  await openDefine();
  expect(within(custodianRow('Alex Wilber')).getByText('Hold requested')).toBeInTheDocument();
  purview.purviewDone = true;
  expect(await within(custodianRow('Alex Wilber')).findByText(/^On hold since /)).toBeInTheDocument();
});

test("a hold Purview couldn't place says so under the custodian (holdFails)", async () => {
  setScenario({ holdFails: true });
  await openDefine();
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(await within(custodianRow('Alex Wilber')).findByRole('alert')).toHaveTextContent(
    "Purview couldn't finish that. Purview could not place the hold. Check the case in the Purview portal and try again.",
  );
  expect(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toHaveAttribute('aria-checked', 'false');
  expect(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toBeEnabled();
});

test('a hold that failed in Purview is shown as failed, and can be tried again', async () => {
  const matter = falcon();
  matter.custodians[0]!.hold = { status: 'failed', since: null };
  server.use(http.get('/api/v1/matters/:matterId', () => HttpResponse.json(matter)));
  await openDefine();
  const row = custodianRow('Alex Wilber');
  expect(within(row).getByText('Hold failed')).toBeInTheDocument();
  expect(within(row).getByRole('alert')).toHaveTextContent('Purview reported that the hold change for Alex Wilber failed.');
  expect(within(row).getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toBeEnabled();
  expect(screen.getByText('1 of 2 custodians on hold · 1 failed')).toBeInTheDocument();
});

test.each([
  ['purview_permission_missing', 'You need a Purview permission for this. You need the eDiscovery Manager role in Purview.'],
  ['license_missing', "Purview eDiscovery isn't available for this account. This tenant has no eDiscovery (Premium) licence"],
] as const)('a hold Purview refuses (purviewDenied: %s) explains why', async (code, words) => {
  setScenario({ purviewDenied: code });
  await openDefine();
  await userEvent.click(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' }));
  expect(await within(custodianRow('Alex Wilber')).findByRole('alert')).toHaveTextContent(words);
  expect(screen.getByRole('switch', { name: 'Legal hold for Alex Wilber' })).toHaveAttribute('aria-checked', 'false');
});

test('a site can be linked to a custodian, and unlinked', async () => {
  const sent = recordWrites();
  await openDefine();
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'Link a site' }));
  const field = screen.getByLabelText('Site address to link to Alex Wilber');
  await userEvent.type(field, 'contoso.sharepoint.com/sites/Procurement{Enter}');
  expect(within(custodianRow('Alex Wilber')).getByRole('alert')).toHaveTextContent(SITE_FORMAT_ERROR);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveAccessibleDescription(SITE_FORMAT_ERROR);
  await expectNoA11yViolations(document.body);
  await userEvent.clear(field);
  await userEvent.type(field, 'https://contoso.sharepoint.com/sites/Procurement/{Enter}');
  expect(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'Link a site' })).toHaveFocus();
  expect(await within(custodianRow('Alex Wilber')).findByRole('list', { name: 'Sites linked to Alex Wilber' })).toHaveTextContent('sites/Procurement');
  await waitFor(() =>
    expect(sent).toEqual([{ method: 'PUT', path: `/matters/mat_falcon/custodians/${ALEX}`, body: { mailbox: true, onedrive: true, sites: ['https://contoso.sharepoint.com/sites/Procurement'] } }]),
  );
  expect(countOf('SharePoint sites')).toBe('3');

  await userEvent.click(screen.getByRole('button', { name: 'Unlink sites/Procurement from Alex Wilber' }));
  await waitFor(() => expect(sent).toHaveLength(2));
  expect(sent[1]!.body).toEqual({ mailbox: true, onedrive: true, sites: [] });
  expect(countOf('SharePoint sites')).toBe('2');
});

test('closing the link-site form puts focus back on "Link a site"', async () => {
  await openDefine();
  const linkButton = () => within(custodianRow('Alex Wilber')).getByRole('button', { name: 'Link a site' });
  await userEvent.click(linkButton());
  expect(screen.getByLabelText('Site address to link to Alex Wilber')).toHaveFocus();
  await userEvent.keyboard('{Escape}');
  expect(linkButton()).toHaveFocus();
  await userEvent.click(linkButton());
  await userEvent.click(within(custodianRow('Alex Wilber')).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByLabelText('Site address to link to Alex Wilber')).not.toBeInTheDocument();
  expect(linkButton()).toHaveFocus();
});

test('a site without a custodian can be added and removed', async () => {
  const sent = recordWrites();
  await openDefine();
  await userEvent.type(screen.getByLabelText('Site address'), 'https://contoso.sharepoint.com/sites/Legal');
  await userEvent.click(screen.getByRole('button', { name: 'Add site' }));
  const list = screen.getByRole('list', { name: 'Sites without a custodian' });
  expect(await within(list).findByText('https://contoso.sharepoint.com/sites/Legal')).toBeInTheDocument();
  await waitFor(() => expect(screen.getByLabelText('Site address')).toHaveValue(''));
  expect(countOf('SharePoint sites')).toBe('3');

  await userEvent.click(await within(list).findByRole('button', { name: 'Remove https://contoso.sharepoint.com/sites/Finance' }));
  await waitFor(() => expect(within(list).queryByText('https://contoso.sharepoint.com/sites/Finance')).not.toBeInTheDocument());
  expect(sent.map((r) => `${r.method} ${r.path}`)).toEqual(['POST /matters/mat_falcon/sites', 'DELETE /matters/mat_falcon/sites/site_finance']);
  expect(sent[0]!.body).toEqual({ url: 'https://contoso.sharepoint.com/sites/Legal' });
  expect(await screen.findByText('Query v4 · draft')).toBeInTheDocument();
});

test("a site address that isn't a site, or is already there, is caught before it is sent", async () => {
  const sent = recordWrites();
  await openDefine();
  const field = screen.getByLabelText('Site address');
  await userEvent.type(field, 'https://example.com/Legal{Enter}');
  expect(screen.getByRole('alert')).toHaveTextContent(SITE_FORMAT_ERROR);
  expect(field).toHaveAttribute('aria-invalid', 'true');
  expect(field).toHaveAccessibleDescription(SITE_FORMAT_ERROR);
  await userEvent.clear(field);
  expect(field).not.toHaveAttribute('aria-invalid');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await userEvent.type(field, 'https://contoso.sharepoint.com/sites/projectfalcon{Enter}'); // linked to Megan Bowen
  expect(screen.getByRole('alert')).toHaveTextContent(SITE_DUPLICATE_ERROR);
  expect(sent).toEqual([]);
});

test("the API's refusals of a site are shown in the design's words", async () => {
  server.use(http.post('/api/v1/matters/:matterId/sites', () => HttpResponse.json({ code: 'conflict', message: 'That site is already part of this matter.', details: {} }, { status: 409 })));
  await openDefine();
  await userEvent.type(screen.getByLabelText('Site address'), 'https://contoso.sharepoint.com/sites/Legal{Enter}');
  expect(await screen.findByRole('alert')).toHaveTextContent(SITE_DUPLICATE_ERROR);
  expect(screen.getByLabelText('Site address')).toHaveAccessibleDescription(SITE_DUPLICATE_ERROR);
  expect(within(screen.getByRole('list', { name: 'Sites without a custodian' })).queryByText('https://contoso.sharepoint.com/sites/Legal')).not.toBeInTheDocument();
});

test('a draft whose criteria changed says the search changed, not who is searched', async () => {
  const draft = example<Schemas['Draft']>('getDraft', '200');
  server.use(
    http.get('/api/v1/matters/:matterId', () => HttpResponse.json({ ...falcon(), draft_changed: true })),
    http.get('/api/v1/matters/:matterId/draft', () => HttpResponse.json({ ...draft, criteria: { ...draft.criteria, keywords: ['falcon'] }, changed_since_version: true })),
  );
  await openDefine();
  const notice = await within(searched()).findByRole('status');
  await waitFor(() => expect(notice).toHaveTextContent('The search has changed.'));
  expect(notice).toHaveTextContent('SearchTrail will create search v4 in Purview.');
});

test("while it isn't known what changed, the notice says neither", async () => {
  server.use(
    http.get('/api/v1/matters/:matterId', () => HttpResponse.json({ ...falcon(), draft_changed: true })),
    http.get('/api/v1/matters/:matterId/versions', async () => {
      await delay(100);
      return undefined; // the mock's own handler
    }),
  );
  await openDefine();
  const notice = await within(searched()).findByRole('status');
  expect(notice).toHaveTextContent('SearchTrail will create search v4 in Purview.');
  expect(notice).not.toHaveTextContent('The search has changed.');
  expect(notice).not.toHaveTextContent('Who is searched has changed.');
  expect(await within(notice).findByText('Who is searched has changed.')).toBeInTheDocument();
});

test('a new matter has nothing in Purview yet', async () => {
  server.use(
    http.get('/api/v1/matters/:matterId', () =>
      HttpResponse.json({ ...falcon(), custodians: [], sites: [], current_version: null, previewed_version: null, last_previewed_at: null, purview_case_id: null }),
    ),
  );
  await openDefine();
  expect(screen.getByText('No custodians yet. Add one above, or search sites only.')).toBeInTheDocument();
  expect(screen.getByText('No custodians on hold')).toBeInTheDocument();
  expect(within(searched()).getByText(/^Nothing has been sent to Purview yet\./)).toBeInTheDocument();
  expect(screen.getByText(/^Not created yet\./)).toBeInTheDocument();
  expect(screen.queryByRole('link', { name: /Open in Purview/ })).not.toBeInTheDocument();
  await expectNoA11yViolations(document.body);
});

test('the words for holds, counts and sites', () => {
  expect(holdText({ status: 'off', since: null })).toBe('Not on hold');
  expect(holdText({ status: 'pending', since: null })).toBe('Hold requested');
  expect(holdText({ status: 'on', since: '2026-11-03T09:20:00Z' })).toBe('On hold since 3 Nov');
  expect(holdText({ status: 'releasing', since: '2026-11-03T09:20:00Z' })).toBe('Release requested');
  expect(holdText({ status: 'failed', since: null })).toBe('Hold failed');
  const c = falcon().custodians;
  expect(holdSummary([])).toBe('No custodians on hold');
  expect(holdSummary(c)).toBe('1 of 2 custodians on hold');
  expect(holdSummary([c[1]!])).toBe('1 of 1 custodian on hold');
  expect(purviewCountText({ mailboxes: 1, onedrives: 0, sharepoint: 1 })).toBe('Purview counts OneDrive accounts as sites, so estimates will show 1 mailbox and 1 site.');
  expect(siteProblem('https://contoso.sharepoint.com/teams/Legal', [])).toBeNull();
  expect(siteProblem('https://contoso.sharepoint.us/sites/Legal', [])).toBeNull();
  expect(siteProblem('https://contoso.sharepoint.com/sites/Legal', ['https://contoso.sharepoint.com/sites/legal/'])).toBe(SITE_DUPLICATE_ERROR);
  expect(siteProblem('http://contoso.sharepoint.com/sites/Legal', [])).toBe(SITE_FORMAT_ERROR);
  expect(siteLabel('https://contoso.sharepoint.com/sites/Project%20Falcon')).toBe('sites/Project Falcon');
});
