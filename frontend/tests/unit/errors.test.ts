import { ApiRequestError, type ApiError } from '@/api/client';
import { describeError, hasCode, type ErrorCode } from '@/api/errors';
import { errorCodes } from './contract';

const apiError = (code: string, message = '', status = 400) =>
  new ApiRequestError(status, { code, message, details: {} } as ApiError);

test('every error code in the contract has a treatment, with a title and words to fall back on', () => {
  expect(errorCodes).toContain('session_expired'); // the list came from the contract
  for (const code of errorCodes) {
    const described = describeError(apiError(code));
    expect(described.code, code).toBe(code);
    expect(described.title, code).not.toBe('');
    expect(described.message, code).not.toBe(''); // the fallback, because the response had no message
  }
});

test("the API's own message is shown, because it says what applies; the title and action come from the code", () => {
  const described = describeError(apiError('criteria_invalid', 'date_from (2025-01-01) is after date_to (2024-01-01)', 422));
  expect(described.message).toBe('date_from (2025-01-01) is after date_to (2024-01-01)');
  expect(described.title).toBe("These search settings can't be turned into a query");
  expect(described.tone).toBe('blocked');
});

test.each<[ErrorCode, string]>([
  ['criteria_invalid', 'blocked'],
  ['export_not_previewed', 'blocked'],
  ['export_counts_changed', 'blocked'],
  ['confirmation_mismatch', 'blocked'],
  ['purview_permission_missing', 'blocked'],
  ['license_missing', 'blocked'],
  ['graph_throttled', 'transient'],
  ['session_expired', 'transient'],
  ['purview_operation_failed', 'error'],
  ['internal_error', 'error'],
])('%s looks %s', (code, tone) => {
  expect(describeError(apiError(code)).tone).toBe(tone);
});

test('a blocked export points at Preview, when the matter is known', () => {
  for (const code of ['export_not_previewed', 'export_counts_changed']) {
    expect(describeError(apiError(code), { matterId: 'mat_falcon' }).action).toEqual({
      kind: 'link',
      label: 'Go to Preview',
      to: '/matters/mat_falcon/preview',
    });
    expect(describeError(apiError(code)).action).toBeUndefined();
  }
});

test('errors that usually pass offer to try again; a missing matter offers the way back', () => {
  for (const code of ['graph_throttled', 'purview_operation_failed', 'internal_error']) {
    expect(describeError(apiError(code)).action).toEqual({ kind: 'retry', label: 'Try again' });
  }
  expect(describeError(apiError('not_found', '', 404)).action).toEqual({ kind: 'link', label: 'Back to Matters', to: '/matters' });
});

test('an ended session offers to sign in, and comes back to the page', () => {
  window.history.pushState({}, '', '/matters/mat_falcon/scope?tab=terms');
  try {
    const action = describeError(apiError('session_expired', '', 401)).action;
    expect(action).toEqual({ kind: 'link', label: 'Sign in', to: '/api/v1/auth/login?return_to=%2Fmatters%2Fmat_falcon%2Fscope%3Ftab%3Dterms' });
  } finally {
    window.history.pushState({}, '', '/');
  }
});

test("a request that never got an answer is a network problem, whatever the message", () => {
  const described = describeError(new TypeError('Failed to fetch'));
  expect(described).toMatchObject({ code: 'network', tone: 'transient', action: { kind: 'retry' } });
  expect(described.title).toBe("Can't reach SearchTrail");
});

test('a code from a newer API is treated as an internal error, and anything else too', () => {
  expect(describeError(apiError('from_the_future', 'Something new.')).code).toBe('internal_error');
  expect(describeError(apiError('from_the_future', 'Something new.')).message).toBe('Something new.');
  expect(describeError(new Error('boom'))).toMatchObject({ code: 'internal_error', tone: 'error' });
  expect(describeError('a string')).toMatchObject({ code: 'internal_error' });
});

test('hasCode tells one API error from another', () => {
  expect(hasCode(apiError('conflict', '', 409), 'conflict')).toBe(true);
  expect(hasCode(apiError('conflict', '', 409), 'not_found')).toBe(false);
  expect(hasCode(new Error('conflict'), 'conflict')).toBe(false);
});

test('a code the contract does not have is an internal error, even one named like a built-in property', () => {
  for (const code of ['not_a_code', 'constructor', 'toString', '__proto__']) {
    const described = describeError(apiError(code, '', 500));
    expect(described.code, code).toBe('internal_error');
    expect(typeof described.title, code).toBe('string');
    expect(described.title, code).not.toBe('');
  }
});
