// Building a preview (counts, breakdowns) for a query version. Used by the preview job, and when seeding the
// matters that have a preview already, so every preview adds up: its breakdowns total its report_items, which
// is its counts' items plus its partially indexed items.
import type { Schemas } from '@/api/client';
import { example } from './examples';
import { clone, iso, nextId } from './util';

type S = Schemas;

/** Spread `total` over the same shape as `buckets`: whole numbers that add up exactly (largest remainder). */
function scaleBuckets<T extends { count: number }>(buckets: T[], total: number): T[] {
  const sum = buckets.reduce((n, b) => n + b.count, 0) || 1;
  const exact = buckets.map((b) => (b.count / sum) * total);
  const counts = exact.map(Math.floor);
  let left = total - counts.reduce((n, c) => n + c, 0);
  [...exact.keys()].sort((a, b) => (exact[b]! % 1) - (exact[a]! % 1)).forEach((i) => {
    if (left > 0) {
      counts[i]! += 1;
      left -= 1;
    }
  });
  return buckets.map((b, i) => ({ ...b, count: counts[i]! }));
}

/** The Falcon example's shape (its locations, types, labels and months), scaled to this version's counts. */
export function buildPreview(matterId: string, version: number, counts: S['Counts'], createdBy: S['UserRef'], options: { id?: string; createdAt?: string } = {}): S['Preview'] {
  const base = example<S['Preview']>('getLatestPreview', '200');
  const total = counts.items + counts.partial_items;
  return {
    id: options.id ?? nextId('prv'), matter_id: matterId, version, created_at: options.createdAt ?? iso(), created_by: createdBy, stale: false, counts: clone(counts),
    report_items: total, encrypted_items: Math.round(total * (base.encrypted_items / base.report_items)),
    breakdowns: {
      by_location: scaleBuckets(base.breakdowns.by_location, total),
      by_type: scaleBuckets(base.breakdowns.by_type, total),
      by_label: scaleBuckets(base.breakdowns.by_label, total),
      by_month: scaleBuckets(base.breakdowns.by_month, total),
    },
    unmapped_columns: [],
  };
}
