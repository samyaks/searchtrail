// Previews (counts, breakdowns, the item table) and term reports.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { filterItems, generatePreviewItems, itemsToCsv } from '../items';
import { alreadyRunning, activeJob, createJob } from '../jobs';
import { termHits } from '../counts';
import { appendLog, signedIn } from '../log';
import { buildMockKql, CriteriaInvalid } from '../kql';
import { buildPreview } from '../previews';
import { criteriaInvalid } from './criteria';
import { route, withMatter } from '../route';
import { db, type MockMatter } from '../db';
import { clone, error, iso, nextId, notFound, pageParams, paginate } from '../util';
import { currentVersion, previewView, termReportView } from '../views';

type S = Schemas;
const user = () => ({ id: signedIn().id, display_name: signedIn().display_name });

const previewItems = (m: MockMatter) => {
  if (m.preview && m.previewItems.length === 0) m.previewItems = generatePreviewItems(m.preview);
  return m.previewItems;
};
const matterOfPreview = (previewId: string) => db.matters.find((m) => m.preview?.id === previewId);

export const runHandlers = [
  route('post', '/matters/:matterId/previews', (context) =>
    withMatter(context, (m) => {
      const version = currentVersion(m);
      if (!version?.counts) return error(409, 'conflict', 'Estimate the query first. A preview builds on its counts.');
      const running = activeJob(m.matter.id, 'preview');
      if (running) return alreadyRunning(running, 'preview');
      return HttpResponse.json(
        createJob('preview', m.matter.id, {
          finish: () => {
            m.preview = buildPreview(m.matter.id, version.version, version.counts!, user());
            m.previewItems = [];
            m.matter.stage = 'previewed';
            m.matter.previewed_version = version.version;
            m.matter.last_previewed_at = m.preview.created_at;
            appendLog(m, 'preview', `Query v${version.version} · ${version.counts!.items.toLocaleString('en-US')} items + ${version.counts!.partial_items.toLocaleString('en-US')} partially indexed`, version.version, { counts: version.counts });
            return clone(m.preview);
          },
        }),
        { status: 202 },
      );
    }),
  ),

  route('get', '/matters/:matterId/previews/latest', (context) =>
    withMatter(context, (m) => {
      const preview = previewView(m);
      return preview ? HttpResponse.json(preview) : notFound('preview for this matter yet');
    }),
  ),

  route('get', '/previews/:previewId/items', ({ params, url }) => {
    const m = matterOfPreview(String(params.previewId));
    if (!m) return notFound('preview');
    const { page, size } = pageParams(url, 50);
    const type = url.searchParams.get('type');
    const filtered = filterItems(previewItems(m), { location: url.searchParams.get('location'), type, label: url.searchParams.get('label') });
    return HttpResponse.json(paginate(filtered, page, size) satisfies S['PreviewItemPage']);
  }),

  route('get', '/previews/:previewId/items.csv', ({ params }) => {
    const m = matterOfPreview(String(params.previewId));
    if (!m) return notFound('preview');
    return new HttpResponse(itemsToCsv(previewItems(m)), { headers: { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${m.matter.matter_number}-preview.csv"` } });
  }),

  route('post', '/matters/:matterId/term-reports', (context) =>
    withMatter(context, (m) => {
      const version = currentVersion(m);
      try {
        buildMockKql(m.draft.criteria);
      } catch (e) {
        if (e instanceof CriteriaInvalid) {
          return m.draft.criteria.keywords.length === 0 ? error(422, 'criteria_invalid', 'There are no search terms to count. Add at least one term first.') : criteriaInvalid(e);
        }
        throw e;
      }
      if (!version) return error(409, 'conflict', 'Estimate the query first. A term report counts within it.');
      const running = activeJob(m.matter.id, 'term_report');
      if (running) return alreadyRunning(running, 'term report');
      return HttpResponse.json(
        createJob('term_report', m.matter.id, {
          finish: () => {
            const previous = m.termReport;
            const total = version.counts?.items ?? 300;
            const rows: S['TermRow'][] = m.draft.criteria.keywords.map((term) => {
              const before = previous?.rows.find((r) => r.term === term || r.term === `"${term}"`);
              const same = previous?.version === version.version;
              // Each term within the version's other filters (counts.ts): the same terms always get the same hits.
              const items = before && same ? before.items : termHits(m, version.criteria, term);
              return {
                term: /\s/.test(term) ? `"${term}"` : term, items, size_bytes: items * 48_213,
                previous_items: before ? (same ? before.previous_items : before.items) : null,
                previous_version: before ? (same ? before.previous_version : previous!.version) : (previous?.version ?? null),
              };
            });
            m.termReport = {
              id: nextId('trm'), matter_id: m.matter.id, version: version.version, created_at: iso(), created_by: user(), stale: false,
              combined: { items: total, size_bytes: total * 48_213 }, rows,
            };
            appendLog(m, 'term_report', `Query v${version.version} · ${rows.length} terms counted`, version.version, { rows });
            return clone(m.termReport);
          },
        }),
        { status: 202 },
      );
    }),
  ),

  route('get', '/matters/:matterId/term-reports/latest', (context) =>
    withMatter(context, (m) => {
      const report = termReportView(m);
      return report ? HttpResponse.json(report) : notFound('term report for this matter yet');
    }),
  ),
];
