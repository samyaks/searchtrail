import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { http, HttpResponse } from 'msw';
import { server } from '@/mocks/server';
import { activityText } from '@/screens/matters/format';
import { renderApp } from './renderApp';

test('the Matters screen shows the contract example data through the generated client', async () => {
  renderApp('/matters');
  const table = await screen.findByRole('table', { name: 'Matters' });
  const rows = within(table).getAllByRole('row').slice(1);
  expect(rows).toHaveLength(5);
  expect(within(rows[0]!).getByRole('link', { name: 'Project Falcon investigation' })).toHaveAttribute(
    'href',
    '/matters/mat_falcon/scope',
  );
  expect(within(rows[0]!).getByText('M-2026-0142')).toBeInTheDocument();
  expect(within(rows[0]!).getByText('630 items')).toBeInTheDocument();
  expect(within(rows[3]!).getByText('Exporting 64%')).toBeInTheDocument();
  expect(within(rows[1]!).getByText('Not estimated yet')).toBeInTheDocument();
});

test('stage filters ask the API for that stage', async () => {
  renderApp('/matters');
  await screen.findByRole('table', { name: 'Matters' });
  await userEvent.click(screen.getByRole('button', { name: 'Exported' }));
  expect(await screen.findByText('Brightwell supply contract dispute')).toBeInTheDocument();
  expect(screen.queryByText('Project Falcon investigation')).not.toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Exported' })).toHaveAttribute('aria-pressed', 'true');
});

test('API errors are shown in plain English', async () => {
  server.use(
    http.get('/api/v1/matters', () =>
      HttpResponse.json(
        { code: 'session_expired', message: 'Your session has ended. Sign in again to continue.', details: {} },
        { status: 401 },
      ),
    ),
  );
  renderApp('/matters');
  expect(await screen.findByRole('alert')).toHaveTextContent('Your session has ended');
});

test('activity dates read like the design', () => {
  const now = new Date('2026-11-05T15:00:00');
  expect(activityText('2026-11-05T10:51:00', now)).toBe('Today 10:51');
  expect(activityText('2026-11-04T16:20:00', now)).toBe('Yesterday 16:20');
  expect(activityText('2026-10-28T14:02:00', now)).toBe('28 Oct');
});
