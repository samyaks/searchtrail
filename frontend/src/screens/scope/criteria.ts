// The Scope screen's logic that needs no React: checking what a person types before it goes into the criteria,
// the label rows, and the words the screen shows. None of this builds KQL: the query and its methodology come
// from POST /kql/preview, which is the backend's `searchtrail.query` (docs/agents/E-screens-matters-define-scope.md).
import type { Schemas } from '@/api/client';

export type Criteria = Schemas['Criteria'];
export type ItemKind = Schemas['ItemKind'];
export type Label = Schemas['Label'];
export type LabelState = 'any' | 'only' | 'exclude';

export const KINDS: { kind: ItemKind; label: string }[] = [
  { kind: 'email', label: 'Emails' },
  { kind: 'chats', label: 'Teams chats' },
  { kind: 'docs', label: 'Documents' },
];

/** The criteria as text that is the same whenever they mean the same thing (object keys sorted), to compare and to key queries by. */
export function stableKey(value: unknown): string {
  const sort = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(sort)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v)
              .sort(([a], [b]) => (a < b ? -1 : 1))
              .map(([k, x]) => [k, sort(x)]),
          )
        : v;
  return JSON.stringify(sort(value));
}

const OPERATORS = ['AND', 'OR', 'NOT', 'NEAR'];

/** A term as the screen writes it: a single word (or word*) as it is, a phrase in quotes, as in the design. */
export function displayTerm(term: string): string {
  return /^\w+\*?$/.test(term) && !OPERATORS.includes(term.toUpperCase()) ? term : `"${term}"`;
}

/** The forms a term may take in the methodology's text, for marking it there. */
export function markForms(terms: readonly string[]): string[] {
  return [...new Set(terms.flatMap((t) => [displayTerm(t), t]))];
}

export type Checked = { value: string; error?: undefined } | { value?: undefined; error: string };

/**
 * A term or phrase as typed, ready to add, or why it can't be added. These are the design's own checks on what
 * was typed; whether the whole query is valid is the API's answer (criteria_invalid).
 */
export function checkTerm(raw: string, existing: readonly string[]): Checked | null {
  const typed = raw.trim();
  if (!typed) return null;
  const term = typed.replace(/^"(.*)"$/, '$1').trim().replace(/\s+/g, ' ');
  if (!term) return null;
  if (term.startsWith('*')) return { error: 'Leading wildcards are not supported in eDiscovery. Put * at the end of a word.' };
  if (term.includes('*') && !/^\w+\*$/.test(term)) return { error: 'A wildcard only works at the end of a single word, like invoic*.' };
  if (term.includes('"')) return { error: 'Leave out quotation marks inside a phrase.' };
  if (existing.some((x) => x.toLowerCase() === term.toLowerCase())) return { error: 'That term is already in the list.' };
  return { value: term };
}

/** A file type as typed ("docx", ".PDF"), or why it can't be added. The contract allows 1 to 10 lower-case letters and digits. */
export function checkExtension(raw: string, existing: readonly string[]): Checked | null {
  const ext = raw.trim().replace(/^\*?\./, '').toLowerCase();
  if (!ext) return null;
  if (!/^[a-z0-9]{1,10}$/.test(ext)) return { error: 'A file type is up to 10 letters and digits, like docx.' };
  if (existing.includes(ext)) return { error: 'That file type is already in the list.' };
  return { value: ext };
}

/** An email domain as typed ("@contoso.com", "Newsletters.Contoso.com"), or why it can't be added. */
export function checkDomain(raw: string, existing: readonly string[]): Checked | null {
  const domain = raw.trim().replace(/^.*@/, '').toLowerCase();
  if (!domain) return null;
  if (!/^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain)) return { error: 'Enter a domain like newsletters.contoso.com.' };
  if (existing.includes(domain)) return { error: 'That domain is already in the list.' };
  return { value: domain };
}

/** Switch one item type on or off, keeping the contract's order and at least one type. Null when it would turn the last one off. */
export function toggleKind(kinds: readonly ItemKind[], kind: ItemKind): ItemKind[] | null {
  const on = new Set(kinds);
  if (on.has(kind)) {
    if (on.size === 1) return null;
    on.delete(kind);
  } else {
    on.add(kind);
  }
  return KINDS.map((k) => k.kind).filter((k) => on.has(k));
}

export type LabelRow = { id: string; name: string; note: string; state: LabelState };

function stateOf(id: string, criteria: Criteria): LabelState {
  if (criteria.label_ids.includes(id)) return 'only';
  if (criteria.exclude_label_ids.includes(id)) return 'exclude';
  return 'any';
}

/**
 * One row per top-level label (choosing a parent also matches its sublabels, so the sublabels have no row of
 * their own), and a row for any sublabel the criteria already name, so nothing they filter on is hidden.
 */
export function labelRows(labels: readonly Label[], criteria: Criteria): LabelRow[] {
  const named = new Set([...criteria.label_ids, ...criteria.exclude_label_ids]);
  const rows: LabelRow[] = [];
  const visit = (label: Label, top: boolean) => {
    if (top || named.has(label.id)) {
      const subs = label.sublabels.map((s) => s.name);
      const note =
        label.description?.trim() ||
        (subs.length ? `Includes the ${subs.join(' and ')} sublabel${subs.length === 1 ? '' : 's'}` : top ? '' : 'Sublabel');
      rows.push({ id: label.id, name: top ? label.name : label.path, note, state: stateOf(label.id, criteria) });
    }
    label.sublabels.forEach((s) => visit(s, false));
  };
  labels.forEach((l) => visit(l, true));
  return rows;
}

/** The criteria with one label set to Any, Only or Exclude. */
export function withLabelState(criteria: Criteria, id: string, state: LabelState): Criteria {
  const label_ids = criteria.label_ids.filter((x) => x !== id);
  const exclude_label_ids = criteria.exclude_label_ids.filter((x) => x !== id);
  if (state === 'only') label_ids.push(id);
  if (state === 'exclude') exclude_label_ids.push(id);
  return { ...criteria, label_ids, exclude_label_ids };
}

/** Where on the screen a criteria field is edited, so an error about it is shown there. */
export type Section = 'terms' | 'dates' | 'types' | 'labels' | 'expert';

export const SECTION_NAMES: Record<Section, string> = {
  terms: 'Search terms',
  dates: 'Dates and item types',
  types: 'Dates and item types',
  labels: 'Sensitivity labels',
  expert: 'Expert KQL',
};

export function sectionOf(field: unknown): Section | null {
  switch (field) {
    case 'keywords':
    case 'keyword_mode':
    case 'exclude_keywords':
      return 'terms';
    case 'date_from':
    case 'date_to':
    case 'doc_date_property':
      return 'dates';
    case 'kinds':
    case 'file_extensions':
    case 'participant_domains':
    case 'exclude_participant_domains':
      return 'types';
    case 'label_ids':
    case 'exclude_label_ids':
      return 'labels';
    case 'raw_kql':
      return 'expert';
    default:
      return null;
  }
}

/** "29.0 MB", as the design writes sizes (in 1,024s). */
export function formatSize(bytes: number): string {
  const mb = bytes / 1_048_576;
  if (mb >= 1024) return `${(mb / 1024).toFixed(1)} GB`;
  return `${mb.toFixed(1)} MB`;
}

export const plural = (n: number, one: string, many = `${one}s`) => `${n.toLocaleString('en-US')} ${n === 1 ? one : many}`;

/** A SharePoint site as the design writes it: "sites/Finance". */
export function sitePath(url: string): string {
  try {
    return decodeURIComponent(new URL(url).pathname.replace(/^\/+|\/+$/g, '')) || url;
  } catch {
    return url;
  }
}

/** Who and what is searched, for the card at the top: "Searching 2 custodians and 2 sites" and the detail under it. */
export function sourcesSummary(matter: Schemas['Matter']): { title: string; detail: string } {
  const sites = [...matter.custodians.flatMap((c) => c.sites), ...matter.sites.map((s) => s.url)];
  const unique = [...new Set(sites)];
  if (matter.custodians.length === 0 && unique.length === 0) {
    return { title: 'Nothing to search yet', detail: 'Add custodians or sites in Define to choose whose data is searched.' };
  }
  const what: string[] = [];
  if (matter.custodians.some((c) => c.mailbox)) what.push('mailboxes, Teams chats');
  if (matter.custodians.some((c) => c.onedrive)) what.push('OneDrive');
  const parts = [
    matter.custodians.map((c) => c.display_name).join(', '),
    what.length ? what.join(' and ') : '',
    unique.map(sitePath).join(', '),
  ].filter(Boolean);
  const title =
    matter.custodians.length && unique.length
      ? `Searching ${plural(matter.custodians.length, 'custodian')} and ${plural(unique.length, 'site')}`
      : matter.custodians.length
        ? `Searching ${plural(matter.custodians.length, 'custodian')}`
        : `Searching ${plural(unique.length, 'site')}`;
  return { title, detail: parts.join(' · ') };
}
