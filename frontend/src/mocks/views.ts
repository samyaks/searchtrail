// What the API shows of a mock matter: details and list entries derived from its state.
import type { Schemas } from '@/api/client';
import { sourcesFingerprint } from './sources';
import { canonical, clone } from './util';
import type { MockMatter } from './db';

type S = Schemas;

export const currentVersion = (m: MockMatter) => m.versions.find((v) => v.version === m.matter.current_version);

/** The matter's custodians and sites differ from what they were when this query version was made. */
export const sourcesChanged = (m: MockMatter, version: number) => sourcesFingerprint(m.matter) !== m.sourcesAt[version];

/** The draft's criteria or the sources differ from the current query version. */
export function draftChanged(m: MockMatter): boolean {
  const version = currentVersion(m);
  if (!version) return false; // nothing to compare with before the first estimate
  return canonical(m.draft.criteria) !== canonical(version.criteria) || sourcesChanged(m, version.version);
}

export function matterView(m: MockMatter): S['Matter'] {
  return { ...clone(m.matter), draft_changed: draftChanged(m) };
}

export function draftView(m: MockMatter): S['Draft'] {
  return { ...clone(m.draft), changed_since_version: draftChanged(m) };
}

export function latestCountsOf(m: MockMatter): S['LatestCounts'] | null {
  const counts = currentVersion(m)?.counts;
  return counts ? { items: counts.items, partial_items: counts.partial_items } : null;
}

export function summaryOf(m: MockMatter): S['MatterSummary'] {
  const preparing = m.exports.find((e) => e.status === 'preparing');
  return {
    id: m.matter.id,
    matter_number: m.matter.matter_number,
    name: m.matter.name,
    stage: m.matter.stage,
    custodian_count: m.matter.custodians.length,
    current_version: m.matter.current_version,
    latest_counts: latestCountsOf(m),
    export_progress: m.matter.stage === 'exporting' && preparing ? preparing.progress : null,
    last_activity_at: m.activityAt,
    owner: m.matter.created_by,
  };
}

/** The latest preview, stale if the query or sources moved on since. */
export function previewView(m: MockMatter): S['Preview'] | null {
  if (!m.preview) return null;
  return { ...clone(m.preview), stale: m.preview.version !== m.matter.current_version || draftChanged(m) };
}

export function termReportView(m: MockMatter): S['TermReport'] | null {
  if (!m.termReport) return null;
  return { ...clone(m.termReport), stale: m.termReport.version !== m.matter.current_version || draftChanged(m) };
}
