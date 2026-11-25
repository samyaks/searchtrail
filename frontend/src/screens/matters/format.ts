import type { Schemas } from '@/api/client';

export const STAGE_LABELS: Record<Schemas['MatterStage'], string> = {
  scoping: 'Scoping',
  previewed: 'Previewed',
  exporting: 'Exporting',
  exported: 'Exported',
};

export function stageText(m: Schemas['MatterSummary']): string {
  const label = STAGE_LABELS[m.stage];
  return m.stage === 'exporting' && m.export_progress != null ? `${label} ${Math.round(m.export_progress * 100)}%` : label;
}

export function itemsText(m: Schemas['MatterSummary']): string {
  return m.latest_counts ? `${m.latest_counts.items.toLocaleString('en-US')} items` : 'Not estimated yet';
}

/** "Today 10:51", "Yesterday 16:20" or "28 Oct", as on the design. */
export function activityText(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const day = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((day(now) - day(d)) / 86_400_000);
  const time = d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
  if (days === 0) return `Today ${time}`;
  if (days === 1) return `Yesterday ${time}`;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' });
}

/** What the empty table says: how to make the first matter, or how to undo the filter or search that hides them all. */
export function emptyText(stage: Schemas['MatterStage'] | undefined, q: string | undefined): string {
  if (stage && q) return 'No matters match. Clear the search or choose All.';
  if (q) return 'No matters match. Clear the search.';
  if (stage) return 'No matters match. Choose All.';
  return 'No matters yet. Choose New matter to create the first one.';
}
