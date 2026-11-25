// How the Export screen writes counts, sizes, dates and states, as the design does.
import type { Schemas } from '@/api/client';

type Counts = Schemas['Counts'];
type Export = Schemas['Export'];

/** The design's starting options: partially indexed items in, PST, no linked files, Teams transcripts. */
export const DEFAULT_OPTIONS: Schemas['ExportOptions'] = {
  include_partially_indexed: true,
  partially_indexed_scope: 'responsiveLocations',
  format: 'pst',
  include_cloud_attachments: false,
  teams_transcripts: true,
};


export const n = (value: number) => value.toLocaleString('en-US');

/** "29.0 MB", "1.2 GB", "820 KB": binary units, one decimal, as Purview shows sizes. */
export function sizeText(bytes: number): string {
  const kb = 1024;
  const mb = kb * 1024;
  const gb = mb * 1024;
  if (bytes >= gb) return `${(bytes / gb).toFixed(1)} GB`;
  if (bytes >= mb) return `${(bytes / mb).toFixed(1)} MB`;
  return `${Math.max(0, Math.round(bytes / kb))} KB`;
}

/** "10:59", the viewer's time, 24-hour clock. */
export const clock = (iso: string) => new Date(iso).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today 10:59", "Yesterday 16:30" or "4 Nov 16:30". */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) return `Today ${clock(iso)}`;
  if (days === 1) return `Yesterday ${clock(iso)}`;
  return `${d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ${clock(iso)}`;
}

/** "4 Dec". */
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
/** "5 Dec 2026". */
export const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });

/** What goes into the package: the matching items, plus the partially indexed ones if they are included. */
export function exportTotals(counts: Counts, includePartial: boolean) {
  return {
    items: counts.items + (includePartial ? counts.partial_items : 0),
    bytes: counts.size_bytes + (includePartial ? counts.partial_size_bytes : 0),
    note: includePartial
      ? `${n(counts.items)} matching + ${n(counts.partial_items)} partially indexed`
      : `${n(counts.items)} matching; ${n(counts.partial_items)} partially indexed left out`,
  };
}

const plural = (count: number, one: string, many: string) => `${count} ${count === 1 ? one : many}`;

/** "2 mailboxes, 4 sites". */
export const sourcesText = (counts: Counts) => `${plural(counts.mailboxes, 'mailbox', 'mailboxes')}, ${plural(counts.sites, 'site', 'sites')}`;

/** "1,148 + 41 partial", or "630" when the partially indexed items were left out. */
export function historyItems(exp: Export): string {
  return exp.options.include_partially_indexed && exp.counts.partial_items > 0
    ? `${n(exp.counts.items)} + ${n(exp.counts.partial_items)} partial`
    : n(exp.counts.items);
}

export type StatusTone = 'ok' | 'running' | 'danger' | 'muted';

/** The status column: the export's state in Purview, then what it means and where its hand-offs are. */
export function exportStatus(exp: Export): { label: string; tone: StatusTone; details: string[] } {
  const details: string[] = [];
  let label: string;
  let tone: StatusTone;
  switch (exp.status) {
    case 'preparing':
      label = 'Preparing in Purview';
      tone = 'running';
      details.push(`${Math.round(exp.progress * 100)}% · usually minutes to hours`);
      break;
    case 'ready':
      label = 'Ready in Purview';
      tone = 'ok';
      if (exp.expires_at) details.push(`Download expires ${shortDate(exp.expires_at)}`);
      break;
    case 'failed':
      label = 'Failed in Purview';
      tone = 'danger';
      details.push('Nothing was exported. Start it again above.');
      break;
    default:
      label = 'Expired';
      tone = 'muted';
      details.push('Purview has deleted the download');
  }
  if (exp.download.status === 'running') details.push(`Downloading the package${exp.download.progress != null ? ` · ${Math.round(exp.download.progress * 100)}%` : ''}`);
  if (exp.download.status === 'done') details.push('Package downloaded to SearchTrail');
  if (exp.download.status === 'failed') details.push("The download didn't finish");
  if (exp.review_set.status === 'running') details.push('Adding to a Purview review set');
  if (exp.review_set.status === 'done') details.push(`In review set ${exp.review_set.name ?? ''}`.trim());
  if (exp.review_set.status === 'failed') details.push("The review set hand-off didn't finish");
  if (exp.changes_accepted) details.push('Count change accepted');
  return { label, tone, details };
}

/** A search term as the methodology writes it: a phrase in quotes. */
export const quoteTerm = (term: string) => (/\s/.test(term) ? `"${term}"` : term);
