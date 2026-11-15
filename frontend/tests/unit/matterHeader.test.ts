import type { Schemas } from '@/api/client';
import { dateText, dayAndTime } from '@/app/time';
import { matterChips, matterSubline } from '@/app/matterHeader';
import { example } from '@/mocks/examples';

const falcon = () => example<Schemas['Matter']>('getMatter', '200');
const NOW = new Date('2026-11-05T15:00:00');
const at = (iso: string) => iso.replace(/Z$/, ''); // local time, so the tests don't depend on the machine's zone

test('the sub line names the case, the people, the sites and when it was opened', () => {
  const matter = { ...falcon(), created_at: at('2026-11-03T09:00:00Z') };
  expect(matterSubline(matter)).toBe('Purview case M-2026-0142 · 2 custodians · 2 SharePoint sites · opened 3 Nov 2026');
});

test('sites linked to a custodian and sites on their own are counted together', () => {
  const matter = falcon();
  matter.sites = [{ id: 's1', url: 'https://contoso.sharepoint.com/sites/A' }];
  matter.custodians = matter.custodians.map((c, i) => ({ ...c, sites: i === 0 ? ['https://contoso.sharepoint.com/sites/B', 'https://contoso.sharepoint.com/sites/C'] : [] }));
  expect(matterSubline(matter)).toContain('3 SharePoint sites');
});

test('one of something is not plural, and a matter with no case yet says so', () => {
  const matter = falcon();
  matter.purview_case_id = null;
  matter.custodians = matter.custodians.slice(0, 1).map((c) => ({ ...c, sites: [] }));
  matter.sites = [{ id: 's1', url: 'https://contoso.sharepoint.com/sites/A' }];
  expect(matterSubline(matter)).toMatch(/^No Purview case yet · 1 custodian · 1 SharePoint site · opened /);
});

test('a previewed query shows its version and when it was previewed', () => {
  const matter = { ...falcon(), current_version: 3, previewed_version: 3, last_previewed_at: at('2026-11-05T10:42:00Z'), draft_changed: false };
  expect(matterChips(matter, NOW)).toEqual({
    version: { text: 'Query v3', tone: 'outline' },
    preview: { text: 'Previewed today 10:42', tone: 'highlight' },
  });
});

test('a changed draft is the next version, and is not previewed', () => {
  const matter = { ...falcon(), current_version: 3, previewed_version: 3, last_previewed_at: at('2026-11-05T10:42:00Z'), draft_changed: true };
  expect(matterChips(matter, NOW)).toEqual({
    version: { text: 'Query v4 · draft', tone: 'outline' },
    preview: { text: 'Not previewed yet', tone: 'draft' },
  });
});

test('an earlier version having been previewed does not make the current one previewed', () => {
  const matter = { ...falcon(), current_version: 4, previewed_version: 3, last_previewed_at: at('2026-11-05T10:42:00Z'), draft_changed: false };
  expect(matterChips(matter, NOW)).toEqual({
    version: { text: 'Query v4', tone: 'outline' },
    preview: { text: 'Not previewed yet', tone: 'draft' },
  });
});

test('a new matter has no query yet', () => {
  const matter = { ...falcon(), current_version: null, previewed_version: null, last_previewed_at: null, draft_changed: false };
  expect(matterChips(matter, NOW)).toEqual({
    version: { text: 'No query yet', tone: 'outline' },
    preview: { text: 'Not previewed yet', tone: 'draft' },
  });
});

test('times read like the design: today and yesterday with the time, else the date', () => {
  expect(dayAndTime(at('2026-11-05T10:42:00Z'), NOW)).toBe('today 10:42');
  expect(dayAndTime(at('2026-11-04T16:20:00Z'), NOW)).toBe('yesterday 16:20');
  expect(dayAndTime(at('2026-10-28T14:02:00Z'), NOW)).toBe('28 Oct');
  expect(dayAndTime(at('2025-12-30T14:02:00Z'), NOW)).toBe('30 Dec 2025');
  expect(dateText(at('2026-11-03T09:00:00Z'))).toBe('3 Nov 2026');
});
