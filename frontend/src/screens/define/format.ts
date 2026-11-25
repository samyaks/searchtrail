// What the Define screen says about a matter's sources and holds, as plain functions (docs/design/Define.dc.html).
import type { Schemas } from '@/api/client';

type Custodian = Schemas['Custodian'];
type Matter = Schemas['Matter'];

/** Which of a custodian's sources are searched: what a PUT .../custodians/{userId} sends. */
export type Sources = { mailbox: boolean; onedrive: boolean; sites: string[] };

export const sourcesOf = (c: Pick<Custodian, 'mailbox' | 'onedrive' | 'sites'>): Sources => ({
  mailbox: c.mailbox,
  onedrive: c.onedrive,
  sites: [...c.sites],
});

/** The contract asks for at least one of mailbox, OneDrive or a site. */
export const hasAnySource = (s: Sources) => s.mailbox || s.onedrive || s.sites.length > 0;

export const MATTER_TYPES: { value: Schemas['MatterType']; label: string }[] = [
  { value: 'investigation', label: 'Internal investigation' },
  { value: 'litigation', label: 'Litigation' },
  { value: 'regulatory', label: 'Regulatory request' },
  { value: 'dsr', label: 'Data subject request' },
];

export const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export type SearchedCounts = { mailboxes: number; onedrives: number; sharepoint: number };

/** The three counts of "What will be searched", from the custodians as shown (unsaved edits included). */
export function searchedCounts(custodians: Sources[], sites: number): SearchedCounts {
  return {
    mailboxes: custodians.filter((c) => c.mailbox).length,
    onedrives: custodians.filter((c) => c.onedrive).length,
    sharepoint: custodians.reduce((n, c) => n + c.sites.length, 0) + sites,
  };
}

/** "Purview counts OneDrive accounts as sites, so estimates will show 2 mailboxes and 3 sites." */
export function purviewCountText({ mailboxes, onedrives, sharepoint }: SearchedCounts): string {
  return `Purview counts OneDrive accounts as sites, so estimates will show ${plural(mailboxes, 'mailbox', 'mailboxes')} and ${plural(onedrives + sharepoint, 'site', 'sites')}.`;
}

const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });

/** The words beside a custodian's hold switch. */
export function holdText(hold: Schemas['Hold']): string {
  switch (hold.status) {
    case 'pending':
      return 'Hold requested';
    case 'on':
      return hold.since ? `On hold since ${shortDate(hold.since)}` : 'On hold';
    case 'releasing':
      return 'Release requested';
    case 'failed':
      return 'Hold failed';
    default:
      return 'Not on hold';
  }
}

/** Purview is still applying a hold change, so the switch waits and the screen keeps asking. */
export const holdSettling = (hold: Schemas['Hold']) => hold.status === 'pending' || hold.status === 'releasing';

/** "1 of 2 custodians on hold", with what Purview is still doing. */
export function holdSummary(custodians: Custodian[]): string {
  const count = (status: Schemas['HoldStatus']) => custodians.filter((c) => c.hold.status === status).length;
  const on = count('on');
  const extra = [
    count('pending') && `${count('pending')} being placed`,
    count('releasing') && `${count('releasing')} being released`,
    count('failed') && `${count('failed')} failed`,
  ].filter(Boolean);
  const head = on === 0 && extra.length === 0 ? 'No custodians on hold' : `${on} of ${plural(custodians.length, 'custodian', 'custodians')} on hold`;
  return extra.length ? `${head} · ${extra.join(', ')}` : head;
}

export const SITE_FORMAT_ERROR = 'Use the full site address, like https://contoso.sharepoint.com/sites/Legal.';
export const SITE_DUPLICATE_ERROR = 'That site is already in the list.';

/** A SharePoint site address as the design accepts it (sharepoint.us too, for US government clouds). */
const SITE_URL = /^https:\/\/[a-z0-9-]+\.sharepoint\.(com|us)\/(sites|teams)\/[^\s/?#]+$/i;

export const normaliseSiteUrl = (text: string) => text.trim().replace(/\/+$/, '');
const sameSite = (a: string, b: string) => normaliseSiteUrl(a).toLowerCase() === normaliseSiteUrl(b).toLowerCase();

/** Every site the matter already searches: linked to a custodian or on its own. */
export const allSites = (matter: Pick<Matter, 'custodians' | 'sites'>) => [...matter.sites.map((s) => s.url), ...matter.custodians.flatMap((c) => c.sites)];

/** Why a site address can't be added, or null if it can. */
export function siteProblem(url: string, existing: string[]): string | null {
  if (!SITE_URL.test(url)) return SITE_FORMAT_ERROR;
  if (existing.some((u) => sameSite(u, url))) return SITE_DUPLICATE_ERROR;
  return null;
}

/** "sites/ProjectFalcon" for https://contoso.sharepoint.com/sites/ProjectFalcon: how the design names a linked site. */
export function siteLabel(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+|\/+$/g, '')) || url;
  } catch {
    return url;
  }
}

/** Criteria compared without regard to key order, to tell a change of sources from a change of criteria. */
export function sameCriteria(a: unknown, b: unknown): boolean {
  const canonical = (value: unknown): unknown =>
    Array.isArray(value)
      ? value.map(canonical)
      : value && typeof value === 'object'
        ? Object.fromEntries(Object.keys(value).sort().map((k) => [k, canonical((value as Record<string, unknown>)[k])]))
        : value;
  return JSON.stringify(canonical(a)) === JSON.stringify(canonical(b));
}
