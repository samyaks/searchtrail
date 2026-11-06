// MSW request handlers built from the contract's examples. WS-D adds one per endpoint.
import { http, HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { example } from './examples';

const API = '/api/v1';

export const handlers = [
  http.get(`${API}/health`, () => HttpResponse.json(example<Schemas['Health']>('getHealth', '200'))),
  http.get(`${API}/me`, () => HttpResponse.json(example<Schemas['Me']>('getMe', '200'))),
  http.get(`${API}/matters`, ({ request }) => {
    const list = example<Schemas['MatterList']>('listMatters', '200');
    const stage = new URL(request.url).searchParams.get('stage');
    const items = stage ? list.items.filter((m) => m.stage === stage) : list.items;
    return HttpResponse.json({ items, total: items.length });
  }),
  http.get(`${API}/matters/:matterId`, ({ params }) => {
    const matter = example<Schemas['Matter']>('getMatter', '200');
    if (params.matterId !== matter.id) {
      return HttpResponse.json(example<Schemas['Error']>('getMatter', '404'), { status: 404 });
    }
    return HttpResponse.json(matter);
  }),
  http.delete(`${API}/matters/:matterId/sites/:siteId`, () => new HttpResponse(null, { status: 204 })),
];
