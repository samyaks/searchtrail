import { http, HttpResponse } from 'msw';
import { api, ApiRequestError, unwrap } from '@/api/client';
import { server } from '@/mocks/server';

test('a successful 204 unwraps to undefined, not an error', async () => {
  const result = await api.DELETE('/matters/{matterId}/sites/{siteId}', {
    params: { path: { matterId: 'mat_falcon', siteId: 'site_finance' } },
  });
  expect(unwrap(result)).toBeUndefined();
});

test('an Error body becomes an ApiRequestError with the contract code', async () => {
  server.use(
    http.get('/api/v1/matters/:matterId', () =>
      HttpResponse.json({ code: 'not_found', message: 'No matter with that ID.', details: {} }, { status: 404 }),
    ),
  );
  const result = await api.GET('/matters/{matterId}', { params: { path: { matterId: 'nope' } } });
  expect(() => unwrap(result)).toThrow(ApiRequestError);
  try {
    unwrap(result);
  } catch (e) {
    expect((e as ApiRequestError).body.code).toBe('not_found');
    expect((e as ApiRequestError).status).toBe(404);
  }
});

test.each([
  ['an HTML page from a proxy', () => new HttpResponse('<html><body>502 Bad Gateway</body></html>', { status: 502, headers: { 'Content-Type': 'text/html' } }), 502],
  ['plain text', () => new HttpResponse('Internal Server Error', { status: 500, headers: { 'Content-Type': 'text/plain' } }), 500],
  ['an empty body', () => new HttpResponse(null, { status: 503 }), 503],
  ['JSON that is not an Error', () => HttpResponse.json({ detail: 'nope' }, { status: 500 }), 500],
])('an error with %s still has a code and a message to show', async (_name, respond, status) => {
  server.use(http.get('/api/v1/matters', respond));
  const result = await api.GET('/matters');
  expect(() => unwrap(result)).toThrow(ApiRequestError);
  try {
    unwrap(result);
  } catch (e) {
    const error = e as ApiRequestError;
    expect(error.status).toBe(status);
    expect(error.body).toEqual({ code: 'internal_error', message: expect.stringContaining(`(${status})`), details: {} });
    expect(error.message).toContain("SearchTrail's server didn't answer properly");
  }
});

test('an error without a body gets the code the API uses for its status', async () => {
  server.use(http.get('/api/v1/matters', () => new HttpResponse(null, { status: 401 })));
  try {
    unwrap(await api.GET('/matters'));
    expect.unreachable();
  } catch (e) {
    expect((e as ApiRequestError).body.code).toBe('session_expired');
  }
});
