// How the Log screen writes things: action names, dates, short hashes and count changes, as the design does.
import type { Schemas } from '@/api/client';

type Action = Schemas['LogAction'];

export const ACTION_LABELS: Record<Action, string> = {
  matter_created: 'Matter created',
  matter_updated: 'Matter updated',
  custodian_added: 'Custodian added',
  custodian_updated: 'Custodian updated',
  custodian_removed: 'Custodian removed',
  site_added: 'Site added',
  site_removed: 'Site removed',
  hold_placed: 'Hold placed',
  hold_released: 'Hold released',
  estimate: 'Estimate',
  preview: 'Preview',
  term_report: 'Term report',
  export_started: 'Export started',
  export_finished: 'Export finished',
  export_downloaded: 'Export downloaded',
  review_set_added: 'Review set',
};

/** How an action's badge looks: the highlighter for a preview, ink for an export, an outline for a term report. */
export function actionTone(action: Action): 'highlight' | 'ink' | 'outline' | 'quiet' {
  if (action === 'preview') return 'highlight';
  if (action === 'export_started' || action === 'export_finished') return 'ink';
  if (action === 'term_report') return 'outline';
  return 'quiet';
}

export const JOB_LABELS: Record<Schemas['JobKind'], string> = {
  estimate: 'An estimate',
  preview: 'A preview',
  term_report: 'A term report',
  export: 'An export',
  download: 'A download',
  review_set: 'A review set hand-off',
};

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
const daysAgo = (d: Date, now: Date) => Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
const clock = (d: Date) => d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const shortDate = (d: Date, now: Date) =>
  d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });

/** "Today", "Yesterday" or "4 Nov": the day a query version was made. */
export function dayText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = daysAgo(d, now);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  return shortDate(d, now);
}

/** "Today 10:51", "Yesterday 16:20" or "4 Nov 16:52": when an entry was written. */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const days = daysAgo(d, now);
  if (days === 0) return `Today ${clock(d)}`;
  if (days === 1) return `Yesterday ${clock(d)}`;
  return `${shortDate(d, now)} ${clock(d)}`;
}

/** "at 11:02" today, otherwise "on 4 Nov at 11:02": when the chain was last checked. */
export function verifiedText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  return daysAgo(d, now) === 0 ? `at ${clock(d)}` : `on ${shortDate(d, now)} at ${clock(d)}`;
}

/** The first and last four characters of a hash, as the design shows it: "41d7…0b9c". */
export const shortHash = (hash: string) => (hash.length > 10 ? `${hash.slice(0, 4)}…${hash.slice(-4)}` : hash);

export const n = (value: number) => value.toLocaleString('en-US');

/** "1,148 → 630 items (−518)", or what is missing when a version has no counts. */
export function countChange(counts: Schemas['VersionComparison']['counts']): string {
  const { from_items: from, to_items: to, delta } = counts;
  if (from === null || to === null) return 'Counts are not available for both versions';
  const change = delta ?? to - from;
  const sign = change > 0 ? '+' : change < 0 ? '−' : '';
  const tail = change === 0 ? 'no change' : `${sign}${n(Math.abs(change))}`;
  return `${n(from)} → ${n(to)} items (${tail})`;
}

/** The line under a version's bar: its day and what changed, and whether it was exported. */
export function versionNote(v: Schemas['QueryVersion'], now: Date = new Date()): string {
  const summary = v.summary.trim();
  const exported = v.exported && !/\bexported$/i.test(summary) ? ' · exported' : '';
  return `${dayText(v.created_at, now)}${summary ? ` · ${summary}` : ''}${exported}`;
}
