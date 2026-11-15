// Health, sign-in, who am I, the setup check, labels and the people directory.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { deniedByPurview, throttledByMicrosoft } from '../denied';
import { example } from '../examples';
import { initialsOf, searchPeople } from '../people';
import { route } from '../route';
import { scenario } from '../scenarios';
import { validationFailed } from '../util';

type S = Schemas;

export const systemHandlers = [
  route('get', '/health', () =>
    scenario.databaseDown ? HttpResponse.json(example<S['Health']>('getHealth', '503'), { status: 503 }) : HttpResponse.json(example<S['Health']>('getHealth', '200')),
  ),

  // Sign-in is a redirect round trip through Microsoft in the real app; here it comes straight back.
  route('get', '/auth/login', ({ url }) => new HttpResponse(null, { status: 302, headers: { Location: url.searchParams.get('return_to') || '/' } })),
  route('get', '/auth/callback', ({ url }) =>
    url.searchParams.get('code') && url.searchParams.get('state')
      ? new HttpResponse(null, { status: 302, headers: { Location: '/' } })
      : validationFailed('code', 'The sign-in response from Microsoft is incomplete. Start again.'),
  ),
  route('post', '/auth/logout', () => new HttpResponse(null, { status: 204 })),

  route('get', '/me', () => HttpResponse.json(example<S['Me']>('getMe', '200'))),
  route('get', '/setup/check', () => HttpResponse.json(example<S['SetupCheck']>('getSetupCheck', '200'))),
  route('get', '/labels', () => deniedByPurview('listLabels') ?? HttpResponse.json(example<S['LabelList']>('listLabels', '200'))),

  route('get', '/directory/users', ({ url }) => {
    const slow = throttledByMicrosoft('searchDirectoryUsers');
    if (slow) return slow;
    const q = (url.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return validationFailed('q', 'Type at least two characters to search.');
    const items = searchPeople(q).map((p) => ({ id: p.id, display_name: p.display_name, email: p.email, department: p.department, initials: initialsOf(p.display_name) }));
    return HttpResponse.json({ items } satisfies S['DirectoryUserList']);
  }),
];

