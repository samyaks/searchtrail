import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router';
import { ApiRequestError, type ApiError } from '@/api/client';
import { ErrorNotice } from '@/components';
import { expectNoA11yViolations } from '../a11y';

const apiError = (code: string, message: string, status = 400) => new ApiRequestError(status, { code, message, details: {} } as ApiError);
const show = (ui: React.ReactElement) => render(<MemoryRouter>{ui}</MemoryRouter>);

test('an error is an alert with a title for its code and the API\'s own message', async () => {
  const { container } = show(<ErrorNotice error={apiError('criteria_invalid', 'date_from is after date_to', 422)} />);
  const alert = screen.getByRole('alert');
  expect(alert).toHaveAttribute('data-tone', 'blocked');
  expect(screen.getByRole('heading', { level: 2, name: "These search settings can't be turned into a query" })).toBeInTheDocument();
  expect(screen.getByText('date_from is after date_to')).toBeInTheDocument();
  expect(screen.queryByRole('button')).not.toBeInTheDocument(); // nothing to do but fix the settings
  await expectNoA11yViolations(container);
});

test('the heading level follows the page', () => {
  show(<ErrorNotice error={apiError('not_found', 'No such matter.', 404)} headingLevel={1} />);
  expect(screen.getByRole('heading', { level: 1, name: "We can't find that" })).toBeInTheDocument();
});

test('"Try again" is offered when the error usually passes and a retry is wired, and calls it', async () => {
  const onRetry = vi.fn();
  show(<ErrorNotice error={apiError('graph_throttled', 'Microsoft is limiting requests.', 429)} onRetry={onRetry} />);
  expect(screen.getByRole('alert')).toHaveAttribute('data-tone', 'transient');
  await userEvent.click(screen.getByRole('button', { name: 'Try again' }));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

test('without a retry to call, no retry button is shown', () => {
  show(<ErrorNotice error={apiError('internal_error', 'It broke.', 500)} />);
  expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument();
});

test('a blocked export links to that matter\'s Preview', () => {
  show(<ErrorNotice error={apiError('export_not_previewed', 'Preview first.', 409)} matterId="mat_falcon" />);
  expect(screen.getByRole('link', { name: 'Go to Preview' })).toHaveAttribute('href', '/matters/mat_falcon/preview');
});

test('an ended session links to the API\'s sign-in as a page load, not a route of the app', () => {
  show(<ErrorNotice error={apiError('session_expired', 'Your session has ended.', 401)} />);
  expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', expect.stringMatching(/^\/api\/v1\/auth\/login\?return_to=/));
});

test('a failed fetch is shown as a network problem', () => {
  show(<ErrorNotice error={new TypeError('Failed to fetch')} onRetry={() => {}} />);
  expect(screen.getByRole('heading', { name: "Can't reach SearchTrail" })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Try again' })).toBeInTheDocument();
});
