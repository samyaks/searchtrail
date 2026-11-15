// The mock backend's memory: matters and everything under them. Seeded from the contract's examples
// (so the mocks serve exactly the data the design and the contract show) and reset between tests.
// Matters other than Falcon have no detailed examples in the contract, so they are derived from their
// list entry, with filler custodians where a matter has more than the six sample people.
import type { Schemas } from '@/api/client';
import { buildMockKql } from './kql';
import { example } from './examples';
import { initialsOf, PEOPLE } from './people';
import { buildPreview } from './previews';
import { sourcesFingerprint } from './sources';
import { clone, fakeHash, iso, resetIds } from './util';

type S = Schemas;

export type MockJob = {
  job: S['Job'];
  /** When the job started and how long it takes, in milliseconds of the mock clock (util.now). */
  startedAt: number;
  durationMs: number;
  /** Runs once, when the job finishes: changes the database and returns the job's result. */
  finish: () => S['Job']['result'];
  /** Runs each time the job moves along, with progress 0..1 (the export's own progress follows its job). */
  onProgress?: (progress: number) => void;
  /** Runs if the job fails (a scenario made it): puts what it was changing back to a failed state. */
  onFail?: () => void;
};

export type MockMatter = {
  matter: S['Matter'];
  activityAt: string;
  draft: S['Draft'];
  versions: S['QueryVersion'][]; // oldest first
  /** The fingerprint of the matter's sources (sources.ts) when each query version was made, by version number. */
  sourcesAt: Record<number, string>;
  preview: S['Preview'] | null;
  previewItems: S['PreviewItem'][];
  termReport: S['TermReport'] | null;
  exports: S['Export'][]; // newest first
  log: S['LogEntry'][]; // oldest first
  /** Hold changes Purview hasn't finished: the next read of the matter settles them. */
  settling: Record<string, 'on' | 'off'>;
};

export type Db = { matters: MockMatter[]; jobs: Map<string, MockJob> };

const OWNERS = { usr_dana: 'Dana Whitfield', usr_sam: 'Sam Ortiz', usr_priya: 'Priya Natarajan' } as const;
const TYPES: Record<string, S['MatterType']> = {
  mat_harlow: 'litigation',
  mat_brightwell: 'litigation',
  mat_q3trading: 'regulatory',
  mat_travel: 'investigation',
  mat_falcon: 'investigation',
};

const EMPTY_CRITERIA = (keyword: string): S['Criteria'] => ({
  keywords: [keyword],
  keyword_mode: 'any',
  exclude_keywords: [],
  date_from: null,
  date_to: null,
  kinds: ['email', 'chats', 'docs'],
  file_extensions: [],
  participant_domains: [],
  exclude_participant_domains: [],
  label_ids: [],
  exclude_label_ids: [],
  doc_date_property: 'lastmodifiedtime',
  raw_kql: null,
});

export const noHold = (): S['Hold'] => ({ status: 'off', since: null });

export function custodianFor(index: number): S['Custodian'] {
  const person = PEOPLE[index];
  const n = index + 1;
  return {
    user_id: person?.id ?? `3c1a7f5e-0000-4000-8000-${String(1000 + n).padStart(12, '0')}`,
    display_name: person?.display_name ?? `Sample custodian ${n}`,
    email: person?.email ?? `sample.custodian${n}@contoso.com`,
    department: person?.department ?? null,
    initials: initialsOf(person?.display_name ?? `Sample ${n}`),
    mailbox: true,
    onedrive: true,
    sites: [],
    hold: noHold(),
  };
}

export function makeCounts(items: number, partial: number, custodians: number): S['Counts'] {
  return { items, size_bytes: items * 48_213, partial_items: partial, partial_size_bytes: partial * 911_000, mailboxes: custodians, sites: custodians + 2 };
}

export function makeVersion(matter: S['Matter'], version: number, criteria: S['Criteria'], counts: S['Counts'] | null, summary: string, fingerprint?: string): S['QueryVersion'] {
  const built = buildMockKql(criteria);
  return {
    version,
    created_at: matter.created_at,
    created_by: matter.created_by,
    summary,
    criteria: clone(criteria),
    kql: built.kql,
    methodology: built.methodology,
    sources_fingerprint: fingerprint ?? sourcesFingerprint(matter),
    purview_search_id: matter.purview_case_id ? `search-${version}` : null,
    counts,
    exported: false,
  };
}

function seedFalcon(summary: S['MatterSummary']): MockMatter {
  const matter = example<S['Matter']>('getMatter', '200');
  const log = example<S['LogEntryPage']>('listLogEntries', '200').items.slice().reverse(); // the example is newest first
  const versions = example<S['QueryVersionList']>('listVersions', '200').items.slice().sort((a, b) => a.version - b.version);
  return {
    matter,
    activityAt: summary.last_activity_at,
    draft: example<S['Draft']>('getDraft', '200'),
    versions,
    // The contract's versions carry their own example fingerprints; what counts for "did the sources change" is
    // the sources as seeded, for every version the matter already has.
    sourcesAt: Object.fromEntries(versions.map((v) => [v.version, sourcesFingerprint(matter)])),
    preview: example<S['Preview']>('getLatestPreview', '200'),
    previewItems: [],
    termReport: example<S['TermReport']>('getLatestTermReport', '200'),
    exports: example<S['ExportList']>('listExports', '200').items,
    log,
    settling: {},
  };
}

function seedOther(summary: S['MatterSummary']): MockMatter {
  const created = new Date(new Date(summary.last_activity_at).getTime() - 5 * 86_400_000);
  const started = summary.stage !== 'scoping';
  const matter: S['Matter'] = {
    id: summary.id,
    matter_number: summary.matter_number,
    name: summary.name,
    type: TYPES[summary.id] ?? 'investigation',
    description: '',
    stage: summary.stage,
    purview_case_id: summary.current_version ? `5e1f0c2a-0000-4000-8000-${String(summary.custodian_count).padStart(12, '0')}` : null,
    created_at: iso(created),
    created_by: summary.owner,
    custodians: Array.from({ length: summary.custodian_count }, (_, i) => custodianFor(i)),
    sites: [],
    current_version: summary.current_version,
    previewed_version: started ? summary.current_version : null,
    last_previewed_at: started ? summary.last_activity_at : null,
    draft_changed: false,
  };
  const criteria = EMPTY_CRITERIA(summary.name.split(/[\s:(]/)[0]?.toLowerCase() ?? 'term');
  const counts = summary.latest_counts ? makeCounts(summary.latest_counts.items, summary.latest_counts.partial_items, summary.custodian_count) : null;
  const versions = Array.from({ length: summary.current_version ?? 0 }, (_, i) =>
    makeVersion(matter, i + 1, criteria, i + 1 === summary.current_version ? counts : null, `Query v${i + 1}`),
  );
  const owner = OWNERS[summary.owner.id as keyof typeof OWNERS] ?? summary.owner.display_name;
  const created_entry: S['LogEntry'] = {
    seq: 1, ts: matter.created_at, action: 'matter_created', actor: owner, actor_email: null, summary: `${matter.matter_number} · ${matter.name}`,
    version: null, prev_hash: '0'.repeat(64), hash: fakeHash(`${matter.id}:1`), details: {},
  };
  const preview = started && counts ? buildPreview(summary.id, summary.current_version ?? 1, counts, summary.owner, { id: `prv_${summary.id}`, createdAt: summary.last_activity_at }) : null;
  const exportRow = (summary.stage === 'exported' || summary.stage === 'exporting') && counts
    ? [{
        ...example<S['Export']>('getExport', '200', 'ready'), id: `exp_${summary.id}`, matter_id: summary.id, version: summary.current_version ?? 1, counts,
        name: `${summary.matter_number} EVERLAW`, status: summary.stage === 'exported' ? ('ready' as const) : ('preparing' as const),
        progress: summary.export_progress ?? 1, finished_at: summary.stage === 'exported' ? summary.last_activity_at : null,
        expires_at: summary.stage === 'exported' ? iso(new Date(new Date(summary.last_activity_at).getTime() + 30 * 86_400_000)) : null,
        files: summary.stage === 'exported' ? example<S['Export']>('getExport', '200', 'ready').files : [],
      }]
    : [];
  return {
    matter, activityAt: summary.last_activity_at,
    draft: { criteria, updated_at: matter.created_at, based_on_version: summary.current_version, changed_since_version: false },
    versions, sourcesAt: Object.fromEntries(versions.map((v) => [v.version, sourcesFingerprint(matter)])), preview, previewItems: [], termReport: null, exports: exportRow, log: [created_entry], settling: {},
  };
}

export function seed(): Db {
  const summaries = example<S['MatterList']>('listMatters', '200').items;
  return { matters: summaries.map((s) => (s.id === 'mat_falcon' ? seedFalcon(s) : seedOther(s))), jobs: new Map() };
}

export let db: Db = seed();
export function resetDb() {
  resetIds();
  db = seed();
}
export const findMatter = (id: string) => db.matters.find((m) => m.matter.id === id);
