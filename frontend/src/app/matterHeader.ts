// What the matter header says about a matter: the line under its name and the two chips beside it.
import type { PillTone } from '@/components';
import type { Schemas } from '@/api/client';
import { dateText, dayAndTime } from './time';

type Matter = Schemas['Matter'];

const count = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

/** "Purview case M-2026-0142 · 2 custodians · 2 SharePoint sites · opened 3 Nov 2026". */
export function matterSubline(matter: Matter): string {
  // Sites linked to a custodian and sites searched on their own are all SharePoint sites to the reader.
  const sites = matter.sites.length + matter.custodians.reduce((total, c) => total + c.sites.length, 0);
  return [
    // The case is made in Purview on the first estimate, so a new matter has none yet.
    matter.purview_case_id ? `Purview case ${matter.matter_number}` : 'No Purview case yet',
    count(matter.custodians.length, 'custodian', 'custodians'),
    count(sites, 'SharePoint site', 'SharePoint sites'),
    `opened ${dateText(matter.created_at)}`,
  ].join(' · ');
}

export type Chip = { text: string; tone: PillTone };

/**
 * The query version and whether it has been previewed. An export is allowed only for a query that was previewed
 * exactly as it stands, so "Not previewed yet" is shown whenever the current version, or a changed draft, hasn't been.
 */
export function matterChips(matter: Matter, now: Date = new Date()): { version: Chip; preview: Chip } {
  const notPreviewed: Chip = { text: 'Not previewed yet', tone: 'draft' };
  const current = matter.current_version;
  if (current === null) return { version: { text: 'No query yet', tone: 'outline' }, preview: notPreviewed };
  if (matter.draft_changed) return { version: { text: `Query v${current + 1} · draft`, tone: 'outline' }, preview: notPreviewed };
  const version: Chip = { text: `Query v${current}`, tone: 'outline' };
  if (matter.previewed_version === current && matter.last_previewed_at) {
    return { version, preview: { text: `Previewed ${dayAndTime(matter.last_previewed_at, now)}`, tone: 'highlight' } };
  }
  return { version, preview: notPreviewed };
}
