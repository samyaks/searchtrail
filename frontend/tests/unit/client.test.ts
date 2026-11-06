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
