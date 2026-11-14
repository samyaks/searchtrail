// The item table behind a preview. The contract has one page of example rows; this makes as many rows as
// the preview reports, spread so that the breakdowns add up exactly: filtering the table by a bar in
// `by_location`, `by_type`, `by_label` or `by_month` gives exactly that bar's count.
import type { Schemas } from '@/api/client';
import { example } from './examples';

type S = Schemas;

const TYPE_BY_NAME: Record<string, S['ItemType']> = { Email: 'email', 'Teams chat': 'teams_chat', Document: 'document' };

/** Item index i -> which bucket of `counts` it falls in, when buckets are filled in order. */
function bucketOf(counts: number[], i: number) {
  let end = 0;
  for (let b = 0; b < counts.length; b += 1) {
    end += counts[b] ?? 0;
    if (i < end) return b;
  }
  return counts.length - 1;
}

export function generatePreviewItems(preview: S['Preview']): S['PreviewItem'][] {
  const templates = example<S['PreviewItemPage']>('listPreviewItems', '200').items;
  const { by_location, by_type, by_label, by_month } = preview.breakdowns;
  const total = preview.report_items;
  const n = Math.max(1, total);
  // Each dimension walks the items in a different order (a stride coprime to n), so the dimensions are independent.
  const stride = (k: number) => {
    let s = k;
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    while (gcd(s, n) !== 1) s += 1;
    return s;
  };
  const strides = [stride(7), stride(11), stride(13), stride(17), stride(19)] as const;
  const at = (dimension: 0 | 1 | 2 | 3 | 4, i: number) => (i * strides[dimension]) % n;
  const items: S['PreviewItem'][] = [];
  for (let i = 0; i < total; i += 1) {
    const template = templates[i % templates.length]!;
    const location = by_location[bucketOf(by_location.map((x) => x.count), at(0, i))]!.name;
    const typeName = by_type[bucketOf(by_type.map((x) => x.count), at(1, i))]!.name;
    const label = by_label[bucketOf(by_label.map((x) => x.count), at(2, i))]!.name;
    const month = by_month[bucketOf(by_month.map((x) => x.count), at(3, i))]!.month;
    const type = TYPE_BY_NAME[typeName] ?? 'other';
    const noun = type === 'email' ? 'RE: ' : type === 'teams_chat' ? 'Chat: ' : '';
    items.push({
      id: `itm_${String(i + 1).padStart(4, '0')}`,
      title: `${noun}${template.title.replace(/^RE: /, '')}${i >= templates.length ? ` (${i + 1})` : ''}`,
      location,
      type,
      date: `${month}-${String(1 + (i % 28)).padStart(2, '0')}T10:00:00Z`,
      label: label === 'No label' ? null : label,
      size_bytes: template.size_bytes,
      encrypted: at(4, i) < preview.encrypted_items, // exactly encrypted_items of them
    });
  }
  return items;
}

/** The same filters as the breakdown bars. */
export function filterItems(items: S['PreviewItem'][], filters: { location?: string | null; type?: string | null; label?: string | null }) {
  return items.filter(
    (item) =>
      (!filters.location || item.location === filters.location) &&
      (!filters.type || item.type === filters.type) &&
      (!filters.label || (filters.label === 'No label' ? item.label === null : item.label === filters.label)),
  );
}

const CSV_COLUMNS = ['item_id', 'location', 'item_type', 'subject', 'author', 'date', 'size', 'sensitivity_label', 'encrypted'];
const CSV_TYPE: Record<S['ItemType'], string> = { email: 'IPM.Note', teams_chat: 'IPM.SkypeTeams.Message', document: 'Document', other: 'Other' };
const csvCell = (value: string | number | boolean | null) => {
  const text = value === null ? '' : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

/** The whole list as the CLI's preview.csv has it. */
export function itemsToCsv(items: S['PreviewItem'][]): string {
  const rows = items.map((item, i) =>
    [`dry-item-${String(i + 1).padStart(5, '0')}`, item.location, CSV_TYPE[item.type], item.title, item.location, item.date, item.size_bytes, item.label, item.encrypted].map(csvCell).join(','),
  );
  return [CSV_COLUMNS.join(','), ...rows].join('\n') + '\n';
}
