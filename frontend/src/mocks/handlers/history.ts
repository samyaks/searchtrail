// What happened and when: query versions, comparing two, and the log with its hash-chain check.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { example } from '../examples';
import { pollJob } from '../jobs';
import { db } from '../db';
import { idParam, route, withMatter } from '../route';
import { scenario } from '../scenarios';
import { clone, iso, notFound, pageParams, paginate, validationFailed } from '../util';

type S = Schemas;
const wholeNumber = (value: string | null) => (value !== null && /^\d+$/.test(value) ? Number(value) : null);

export const historyHandlers = [
  route('get', '/matters/:matterId/versions', (context) =>
    withMatter(context, (m) => HttpResponse.json({ items: clone(m.versions).sort((a, b) => b.version - a.version) } satisfies S['QueryVersionList'])),
  ),

  route('get', '/matters/:matterId/versions/compare', (context) =>
    withMatter(context, (m) => {
      const from = wholeNumber(context.url.searchParams.get('from'));
      const to = wholeNumber(context.url.searchParams.get('to'));
      if (from === null || to === null) return validationFailed('from', 'from and to must be query version numbers.');
      const a = m.versions.find((v) => v.version === from);
      const b = m.versions.find((v) => v.version === to);
      if (!a || !b) return notFound('query version');
      // The contract's own comparison for the Falcon matter's v2 -> v3.
      if (m.matter.id === 'mat_falcon' && from === 2 && to === 3) return HttpResponse.json(example<S['VersionComparison']>('compareVersions', '200'));
      const changes: S['VersionComparison']['changes'] = [
        ...b.methodology.filter((line) => !a.methodology.includes(line)).map((text) => ({ change: 'added' as const, text })),
        ...a.methodology.filter((line) => !b.methodology.includes(line)).map((text) => ({ change: 'removed' as const, text })),
      ];
      const delta = a.counts && b.counts ? b.counts.items - a.counts.items : null;
      return HttpResponse.json({
        from, to, changes, unchanged: changes.length ? '' : 'the criteria and sources.', sources_changed: a.sources_fingerprint !== b.sources_fingerprint,
        counts: { from_items: a.counts?.items ?? null, to_items: b.counts?.items ?? null, delta },
      } satisfies S['VersionComparison']);
    }),
  ),

  route('get', '/matters/:matterId/log', (context) =>
    withMatter(context, (m) => {
      const { page, size } = pageParams(context.url, 50);
      return HttpResponse.json(paginate(clone(m.log).reverse(), page, size) satisfies S['LogEntryPage']); // newest first
    }),
  ),

  route('post', '/matters/:matterId/log/verify', (context) =>
    withMatter(context, (m) => {
      const entries = m.log.length;
      const bad = scenario.logTampered ? Math.min(5, entries) : null;
      return HttpResponse.json({
        ok: bad === null, entries, first_bad_seq: bad, verified_at: iso(),
        message: bad === null ? `${entries} entries verified, chain intact` : `Entry ${bad}: contents were modified after it was written`,
      } satisfies S['LogVerification']);
    }),
  ),
];

export const jobHandlers = [
  route('get', '/matters/:matterId/jobs', (context) =>
    withMatter(context, (m) => {
      const active = context.url.searchParams.get('active') === 'true';
      const kind = context.url.searchParams.get('kind');
      const items = [...db.jobs.values()]
        .map((j) => j.job)
        .filter((j) => j.matter_id === m.matter.id && (!kind || j.kind === kind) && (!active || j.status === 'queued' || j.status === 'running'))
        .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id));
      return HttpResponse.json({ items: clone(items) } satisfies S['JobList']);
    }),
  ),

  // Each poll moves the job along (see jobs.ts).
  route('get', '/jobs/:jobId', (context) => {
    const job = pollJob(idParam(context, 'jobId'));
    return job ? HttpResponse.json(job) : notFound('job');
  }),
];
