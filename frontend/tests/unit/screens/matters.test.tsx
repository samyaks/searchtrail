import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { db } from '@/mocks/db';
import { server } from '@/mocks/server';
import { activityText } from '@/screens/matters/format';
import { EXPORTING_REFRESH_MS } from '@/screens/matters/hooks';
import { fieldOfError, toBody, validate } from '@/screens/matters/newMatter';
import { ApiRequestError } from '@/api/client';
import { expectNoA11yViolations } from '../a11y';
import { renderApp } from '../renderApp';

/** The query string of every GET /matters the screen makes. */
function watchListRequests() {
  const seen: URLSearchParams[] = [];
  server.events.on('request:start', ({ request }) => {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/v1/matters') seen.push(url.searchParams);
  });
  return seen;
}

const rowsOf = (table: HTMLElement) => within(table).getAllByRole('row').slice(1);
const chip = (name: RegExp) => screen.getByRole('button', { name });

test('the Matters screen shows the contract example data through the generated client', async () => {
  renderApp('/matters');
  const table = await screen.findByRole('table', { name: 'Matters' });
  const rows = rowsOf(table);
  expect(rows).toHaveLength(5);
  expect(within(rows[0]!).getByRole('link', { name: 'Project Falcon investigation' })).toHaveAttribute('href', '/matters/mat_falcon/scope');
  expect(within(rows[0]!).getByText('M-2026-0142')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('630 items')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('Query v3')).toBeInTheDocument();
  expect(within(rows[3]!).getByText('Exporting 64%')).toBeInTheDocument();
  expect(within(rows[1]!).getByText('Not estimated yet')).toBeInTheDocument();
  // The name is the row's header, so a screen reader announces it with each cell.
  expect(within(rows[0]!).getByRole('rowheader')).toHaveTextContent('Project Falcon investigation');
});

test('each stage chip shows how many matters are in it, whatever the filter', async () => {
  renderApp('/matters');
  await screen.findByRole('button', { name: 'All 5' });
  expect(chip(/^Scoping/)).toHaveAccessibleName('Scoping 1');
  expect(chip(/^Previewed/)).toHaveAccessibleName('Previewed 1');
  expect(chip(/^Exporting/)).toHaveAccessibleName('Exporting 1');
  expect(chip(/^Exported/)).toHaveAccessibleName('Exported 2');
  expect(chip(/^All/)).toHaveAttribute('aria-pressed', 'true');

  await userEvent.click(chip(/^Exported/));
  await waitFor(() => expect(rowsOf(screen.getByRole('table', { name: 'Matters' }))).toHaveLength(2));
  expect(chip(/^All/)).toHaveAccessibleName('All 5');
  expect(chip(/^Scoping/)).toHaveAccessibleName('Scoping 1');
});

test('stage filters ask the API for that stage', async () => {
  const seen = watchListRequests();
  renderApp('/matters');
  await screen.findByRole('table', { name: 'Matters' });
  await userEvent.click(chip(/^Exported/));
  expect(await screen.findByText('Brightwell supply contract dispute')).toBeInTheDocument();
  await waitFor(() => expect(screen.queryByText('Project Falcon investigation')).not.toBeInTheDocument());
  expect(chip(/^Exported/)).toHaveAttribute('aria-pressed', 'true');
  expect(seen.some((p) => p.get('stage') === 'exported')).toBe(true);

  await userEvent.click(chip(/^All/));
  expect(await screen.findByText('Project Falcon investigation')).toBeInTheDocument();
});

test('the search asks the API, once the person stops typing, by matter number or name', async () => {
  const seen = watchListRequests();
  renderApp('/matters');
  await screen.findByRole('table', { name: 'Matters' });
  const search = screen.getByRole('searchbox', { name: 'Search matters' });
  expect(search).toHaveAttribute('placeholder', 'Matter ID or name');

  await userEvent.type(search, 'brightwell');
  await waitFor(() => expect(rowsOf(screen.getByRole('table', { name: 'Matters' }))).toHaveLength(1));
  expect(screen.getByText('Brightwell supply contract dispute')).toBeInTheDocument();
  // Debounced: one request for the whole word, not one per letter.
  const searches = seen.filter((p) => p.has('q')).map((p) => p.get('q'));
  expect(searches.at(-1)).toBe('brightwell');
  expect(searches.length).toBeLessThan(3);

  await userEvent.clear(search);
  await userEvent.type(search, 'M-2026-0137');
  await waitFor(() => expect(screen.queryByText('Brightwell supply contract dispute')).not.toBeInTheDocument());
  expect(screen.getByText('Harlow v. Contoso (employment)')).toBeInTheDocument();
});

test('the search and the stage filter combine, and say so when nothing matches', async () => {
  renderApp('/matters');
  await screen.findByRole('table', { name: 'Matters' });
  await userEvent.click(chip(/^Scoping/));
  await userEvent.type(screen.getByRole('searchbox', { name: 'Search matters' }), 'falcon');
  expect(await screen.findByText('No matters match. Clear the search or choose All.')).toBeInTheDocument();

  await userEvent.click(chip(/^All/));
  expect(await screen.findByText('Project Falcon investigation')).toBeInTheDocument();
});

test('with no matters at all, the list says how to make the first one', async () => {
  server.use(http.get('/api/v1/matters', () => HttpResponse.json({ items: [], total: 0 })));
  renderApp('/matters');
  expect(await screen.findByText('No matters yet. Choose New matter to create the first one.')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'All 0' })).toBeInTheDocument();
});

test('a matter that is exporting is read again, so its percentage moves', async () => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  try {
    renderApp('/matters');
    expect(await screen.findByText('Exporting 64%')).toBeInTheDocument();
    const exporting = db.matters.find((m) => m.matter.stage === 'exporting')!;
    exporting.exports[0]!.progress = 0.81;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(EXPORTING_REFRESH_MS + 100);
    });
    expect(await screen.findByText('Exporting 81%')).toBeInTheDocument();
  } finally {
    vi.useRealTimers();
  }
});

test('API errors are shown in plain English', async () => {
  server.use(
    http.get('/api/v1/matters', () =>
      HttpResponse.json({ code: 'session_expired', message: 'Your session has ended. Sign in again to continue.', details: {} }, { status: 401 }),
    ),
  );
  renderApp('/matters');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended');
});

test('a list that fails to load can be tried again', async () => {
  let fail = true;
  server.use(
    http.get('/api/v1/matters', () =>
      fail ? HttpResponse.json({ code: 'internal_error', message: 'Something went wrong.', details: {} }, { status: 500 }) : undefined,
    ),
  );
  renderApp('/matters');
  const alert = await screen.findByRole('alert');
  fail = false;
  await userEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
  expect(await screen.findByRole('table', { name: 'Matters' })).toBeInTheDocument();
});

// -- New matter -------------------------------------------------------------------------------------------

async function openForm() {
  await screen.findByRole('table', { name: 'Matters' });
  await userEvent.click(screen.getByRole('button', { name: 'New matter' }));
  return screen.getByRole('region', { name: 'New matter' });
}

test('New matter creates the matter and opens its Define tab', async () => {
  const router = renderApp('/matters');
  const form = await openForm();
  const number = within(form).getByRole('textbox', { name: 'Matter number' });
  expect(number).toHaveFocus();

  await userEvent.type(number, ' M-2026-0150 ');
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Northwind data subject request');
  await userEvent.selectOptions(within(form).getByRole('combobox', { name: 'Matter type' }), 'Data subject request');
  await userEvent.type(within(form).getByRole('textbox', { name: /Description/ }), 'Access request from a former employee.');
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));

  await waitFor(() => expect(router.state.location.pathname).toMatch(/^\/matters\/[^/]+\/define$/));
  expect(await screen.findByRole('heading', { level: 1, name: 'Northwind data subject request' })).toBeInTheDocument();
  const created = db.matters.find((m) => m.matter.matter_number === 'M-2026-0150')!.matter;
  expect(created).toMatchObject({ matter_number: 'M-2026-0150', type: 'dsr', description: 'Access request from a former employee.' });
  expect(router.state.location.pathname).toBe(`/matters/${created.id}/define`);

  // Back on the list, the new matter and the new count are there.
  await act(() => router.navigate('/matters'));
  expect(await screen.findByRole('link', { name: 'Northwind data subject request' })).toBeInTheDocument();
  expect(await screen.findByRole('button', { name: 'All 6' })).toBeInTheDocument();
  expect(chip(/^Scoping/)).toHaveAccessibleName('Scoping 2');
});

test('New matter checks the fields before sending, and points at the first problem', async () => {
  let posted = 0;
  server.events.on('request:start', ({ request }) => request.method === 'POST' && (posted += 1));
  renderApp('/matters');
  const form = await openForm();
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));

  const number = within(form).getByRole('textbox', { name: 'Matter number' });
  expect(within(form).getByText('Enter a matter number.')).toBeInTheDocument();
  expect(within(form).getByText('Enter a name for the matter.')).toBeInTheDocument();
  expect(number).toHaveAttribute('aria-invalid', 'true');
  expect(number).toHaveAccessibleDescription(expect.stringContaining('Enter a matter number.'));
  expect(number).toHaveFocus();

  await userEvent.type(number, 'M 2026/1');
  expect(within(form).queryByText('Enter a matter number.')).not.toBeInTheDocument(); // cleared as they type
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));
  expect(within(form).getByText(/Use letters, digits, dots, dashes or underscores/)).toBeInTheDocument();
  expect(posted).toBe(0);
});

test('a matter number already in use is shown under the field', async () => {
  const router = renderApp('/matters');
  const form = await openForm();
  const number = within(form).getByRole('textbox', { name: 'Matter number' });
  await userEvent.type(number, 'M-2026-0142');
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Falcon again');
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));

  expect(await within(form).findByText('A matter with number M-2026-0142 already exists.')).toBeInTheDocument();
  expect(number).toHaveAttribute('aria-invalid', 'true');
  expect(number).toHaveFocus();
  expect(router.state.location.pathname).toBe('/matters');

  // Changing the number takes the message away, and the next try goes through.
  await userEvent.type(number, '-B');
  expect(within(form).queryByText(/already exists/)).not.toBeInTheDocument();
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));
  await waitFor(() => expect(router.state.location.pathname).toMatch(/\/define$/));
});

test("the API's own validation errors go under the field they name", async () => {
  server.use(
    http.post('/api/v1/matters', () =>
      HttpResponse.json(
        { code: 'validation_failed', message: 'The request is not valid.', details: { errors: [{ loc: ['body', 'name'], msg: 'too long' }] } },
        { status: 400 },
      ),
    ),
  );
  renderApp('/matters');
  const form = await openForm();
  await userEvent.type(within(form).getByRole('textbox', { name: 'Matter number' }), 'M-1');
  const name = within(form).getByRole('textbox', { name: 'Name' });
  await userEvent.type(name, 'Something');
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));
  expect(await within(form).findByText('The request is not valid.')).toBeInTheDocument();
  expect(name).toHaveAttribute('aria-invalid', 'true');
});

test('any other failure is explained in the form, which keeps what was typed', async () => {
  server.use(
    http.post('/api/v1/matters', () =>
      HttpResponse.json({ code: 'internal_error', message: "SearchTrail couldn't save the matter.", details: {} }, { status: 500 }),
    ),
  );
  renderApp('/matters');
  const form = await openForm();
  await userEvent.type(within(form).getByRole('textbox', { name: 'Matter number' }), 'M-1');
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Something');
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));
  const alert = await within(form).findByRole('alert');
  expect(alert).toHaveTextContent('Something went wrong on our side');
  expect(alert).toHaveTextContent("SearchTrail couldn't save the matter.");
  expect(within(form).getByRole('textbox', { name: 'Name' })).toHaveValue('Something');
});

test('Cancel closes the form and puts focus back on New matter', async () => {
  renderApp('/matters');
  const form = await openForm();
  await userEvent.type(within(form).getByRole('textbox', { name: 'Name' }), 'Half typed');
  await userEvent.click(within(form).getByRole('button', { name: 'Cancel' }));
  expect(screen.queryByRole('region', { name: 'New matter' })).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'New matter' })).toHaveFocus();
});

test('the screen, with the form open and showing errors, has no accessibility problems', async () => {
  renderApp('/matters');
  const form = await openForm();
  await screen.findByRole('button', { name: 'All 5' });
  await expectNoA11yViolations(document.body);
  await userEvent.click(within(form).getByRole('button', { name: 'Create matter' }));
  await expectNoA11yViolations(document.body);
});

// -- the rules, on their own ------------------------------------------------------------------------------

test('the form trims what was typed and checks the contract limits', () => {
  const body = toBody({ matter_number: '  M-1 ', name: ' A ', type: 'litigation', description: ' x ' });
  expect(body).toEqual({ matter_number: 'M-1', name: 'A', type: 'litigation', description: 'x' });
  expect(validate(body)).toEqual({});
  expect(validate({ ...body, matter_number: '-M1' }).matter_number).toMatch(/starting with a letter or digit/);
  expect(validate({ ...body, matter_number: 'M'.repeat(65) }).matter_number).toBeDefined();
  expect(validate({ ...body, name: 'n'.repeat(201) }).name).toMatch(/200 characters/);
  expect(validate({ ...body, description: 'd'.repeat(2001) }).description).toMatch(/2,000 characters/);
});

test('an API error is matched to its field from the mocks or from FastAPI', () => {
  const err = (code: string, details: Record<string, unknown>) => new ApiRequestError(400, { code, message: 'x', details } as never);
  expect(fieldOfError(err('conflict', {}))).toBe('matter_number');
  expect(fieldOfError(err('validation_failed', { field: 'description' }))).toBe('description');
  expect(fieldOfError(err('validation_failed', { errors: [{ loc: ['body', 'matter_number'], msg: 'bad' }] }))).toBe('matter_number');
  expect(fieldOfError(err('validation_failed', { field: 'body' }))).toBeUndefined();
  expect(fieldOfError(err('internal_error', { field: 'name' }))).toBeUndefined();
  expect(fieldOfError(new Error('x'))).toBeUndefined();
});

test('activity dates read like the design', () => {
  const now = new Date('2026-11-05T15:00:00');
  expect(activityText('2026-11-05T10:51:00', now)).toBe('Today 10:51');
  expect(activityText('2026-11-04T16:20:00', now)).toBe('Yesterday 16:20');
  expect(activityText('2026-10-28T14:02:00', now)).toBe('28 Oct');
});
