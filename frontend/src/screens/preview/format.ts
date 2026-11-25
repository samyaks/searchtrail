// How the Preview screen writes sizes, types and the item table's filters.
import type { Schemas } from '@/api/client';
import type { ItemFilter } from './hooks';

/** 49152 -> "48 KB", 1258291 -> "1.2 MB", 30408704 -> "29.0 MB" (powers of 1024, as Purview reports them). */
export function sizeText(bytes: number | null | undefined): string {
  if (bytes === null || bytes === undefined) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export const TYPE_LABELS: Record<Schemas['ItemType'], string> = {
  email: 'Email',
  teams_chat: 'Teams chat',
  document: 'Document',
  other: 'Other',
};

/** A `by_type` bar's name ("Teams chat") as the API's item type, for the item table's filter. */
export function itemTypeOf(name: string): Schemas['ItemType'] {
  const found = (Object.keys(TYPE_LABELS) as Schemas['ItemType'][]).find((type) => TYPE_LABELS[type].toLowerCase() === name.trim().toLowerCase());
  return found ?? 'other';
}

export type Dimension = 'location' | 'type' | 'label';

/** The bar chosen as the item table's filter: which breakdown, the bar's name and its count. */
export type BarFilter = { dimension: Dimension; name: string; count: number };

export const barKey = (dimension: Dimension, name: string) => `${dimension}:${name}`;

export function toItemFilter(filter: BarFilter | null): ItemFilter {
  if (!filter) return {};
  if (filter.dimension === 'type') return { type: itemTypeOf(filter.name) };
  return { [filter.dimension]: filter.name };
}

const n = (value: number) => value.toLocaleString('en-US');

const WHERE: Record<Dimension, string> = { location: 'the location is', type: 'the type is', label: 'the label is' };

/** "Showing 1–10 of 655", or "Showing 1–10 of the 223 where the type is Email". */
export function showingText(page: Pick<Schemas['PreviewItemPage'], 'total' | 'page' | 'page_size' | 'items'>, filter: BarFilter | null): string {
  const first = page.items.length === 0 ? 0 : (page.page - 1) * page.page_size + 1;
  const last = first === 0 ? 0 : first + page.items.length - 1;
  const range = page.total === 0 ? 'No items' : `Showing ${n(first)}–${n(last)}`;
  if (filter) return `${range} of the ${n(page.total)} where ${WHERE[filter.dimension]} ${filter.name}`;
  return page.total === 0 ? range : `${range} of ${n(page.total)}`;
}

/** "Jan 2024 to Jun 2025": the months the chart covers. */
export function monthSpan(months: readonly { month: string }[]): string | undefined {
  if (months.length === 0) return undefined;
  const short = (m: string) => {
    const [year, month] = m.split('-');
    return `${['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][Number(month) - 1] ?? month} ${year}`;
  };
  const first = short(months[0]!.month);
  const last = short(months[months.length - 1]!.month);
  return first === last ? first : `${first} to ${last}`;
}
