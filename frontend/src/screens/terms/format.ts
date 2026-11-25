// How the Terms screen writes counts, sizes, changes and times, the way the design does.
import type { Schemas } from '@/api/client';

type TermRow = Schemas['TermRow'];

const n = (value: number) => value.toLocaleString('en-US');

/** "29.0 MB", "512 KB": binary units, one decimal from MB up, as the design's sizes are. */
export function sizeText(bytes: number): string {
  const KB = 1024;
  const MB = KB * 1024;
  const GB = MB * 1024;
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`;
  if (bytes >= MB) return `${(bytes / MB).toFixed(1)} MB`;
  if (bytes >= KB) return `${Math.round(bytes / KB)} KB`;
  return `${bytes} B`;
}

/** The version the report compares with: the previous report's, if there was one. */
export function previousVersionOf(rows: readonly TermRow[]): number | null {
  return rows.find((row) => row.previous_version !== null)?.previous_version ?? null;
}

/** The change column's heading: "Since v2". */
export function changeHeader(rows: readonly TermRow[]): string {
  const previous = previousVersionOf(rows);
  return previous === null ? 'Since last count' : `Since v${previous}`;
}

/**
 * "−83 from 188", "+12 from 40", "No change from 188", "New in v3", or "No earlier count". `previousVersion` is the
 * report's (previousVersionOf its rows), so a new term reads "New in v3" whenever there was an earlier count.
 */
export function changeText(row: TermRow, version: number, previousVersion: number | null): string {
  if (row.previous_items === null) return previousVersion === null ? 'No earlier count' : `New in v${version}`;
  const diff = row.items - row.previous_items;
  if (diff === 0) return `No change from ${n(row.previous_items)}`;
  return `${diff < 0 ? '−' : '+'}${n(Math.abs(diff))} from ${n(row.previous_items)}`;
}

/** A bar's length: the term's hits as a share of all terms combined, 0 to 100. */
export function barPercent(items: number, combined: number): number {
  if (combined <= 0) return 0;
  return Math.min(100, Math.max(0, (items / combined) * 100));
}

const dayStart = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "at 10:51", "yesterday at 16:20", "on 28 Oct at 10:51" (with the year when it isn't this one). The viewer's time zone. */
export function whenText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  const days = Math.round((dayStart(now) - dayStart(d)) / 86_400_000);
  if (days === 0) return `at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  const date = d.toLocaleDateString('en-GB', d.getFullYear() === now.getFullYear() ? { day: 'numeric', month: 'short' } : { day: 'numeric', month: 'short', year: 'numeric' });
  return `on ${date} at ${time}`;
}

export const countText = n;
