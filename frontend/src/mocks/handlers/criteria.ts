// The search criteria: the draft being edited, the live KQL preview, and estimates of a query version.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { estimateCounts } from '../counts';
import { makeVersion } from '../db';
import { deniedByPurview } from '../denied';
import { appendLog } from '../log';
import { buildMockKql, CriteriaInvalid } from '../kql';
import { alreadyRunning, activeJob, createJob } from '../jobs';
import { readJson, route, withMatter } from '../route';
import { clone, error, iso, validationFailed } from '../util';
import { sourcesFingerprint } from '../sources';
import { currentVersion, draftChanged, draftView, sourcesChanged } from '../views';

type S = Schemas;
const KINDS = ['email', 'chats', 'docs'];

/** Why criteria can't be saved at all (their shape is wrong). Whether they can be searched is a separate check. */
function shapeProblem(criteria: unknown): string | null {
  if (!criteria || typeof criteria !== 'object') return 'criteria must be an object.';
  const c = criteria as Record<string, unknown>;
  const lists = ['keywords', 'exclude_keywords', 'file_extensions', 'participant_domains', 'exclude_participant_domains', 'label_ids', 'exclude_label_ids', 'kinds'];
  for (const key of lists) if (!Array.isArray(c[key]) || (c[key] as unknown[]).some((v) => typeof v !== 'string')) return `${key} must be a list of text.`;
  if (c.keyword_mode !== 'any' && c.keyword_mode !== 'all') return 'keyword_mode must be any or all.';
  if ((c.kinds as string[]).length === 0 || (c.kinds as string[]).some((k) => !KINDS.includes(k))) return 'kinds must include at least one of email, chats and docs.';
  if (c.doc_date_property !== 'lastmodifiedtime' && c.doc_date_property !== 'created') return 'doc_date_property must be lastmodifiedtime or created.';
  for (const key of ['date_from', 'date_to'] as const) if (c[key] !== null && !(typeof c[key] === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(c[key] as string))) return `${key} must be a date (YYYY-MM-DD) or null.`;
  return null;
}

/** The contract's 422 for criteria the builder refuses, naming the field it is about when there is one. */
export const criteriaInvalid = (e: CriteriaInvalid) => error(422, 'criteria_invalid', e.message, e.field ? { field: e.field } : {});

export const criteriaHandlers = [
  route('get', '/matters/:matterId/draft', (context) => withMatter(context, (m) => HttpResponse.json(draftView(m)))),

  route('put', '/matters/:matterId/draft', (context) =>
    withMatter(context, async (m) => {
      const body = await readJson(context.request);
      const problem = shapeProblem(body?.criteria);
      if (problem) return validationFailed('criteria', problem);
      m.draft = { criteria: clone(body!.criteria as S['Criteria']), updated_at: iso(), based_on_version: m.matter.current_version, changed_since_version: false };
      return HttpResponse.json(draftView(m));
    }),
  ),

  // Instant, no Purview call: the Scope screen asks for this as the user types.
  route('post', '/kql/preview', async ({ request }) => {
    const body = await readJson(request);
    const problem = shapeProblem(body?.criteria);
    if (problem) return validationFailed('criteria', problem);
    try {
      return HttpResponse.json(buildMockKql(body!.criteria as S['Criteria']));
    } catch (e) {
      if (e instanceof CriteriaInvalid) return criteriaInvalid(e);
      throw e;
    }
  }),

  route('post', '/matters/:matterId/estimates', (context) =>
    withMatter(context, (m) => {
      const denied = deniedByPurview('startEstimate');
      if (denied) return denied;
      // Criteria the builder refuses (a From date after the To date, say) never reach Purview: 422, no counts.
      try {
        buildMockKql(m.draft.criteria);
      } catch (e) {
        if (e instanceof CriteriaInvalid) return criteriaInvalid(e);
        throw e;
      }
      const running = activeJob(m.matter.id, 'estimate');
      if (running) return alreadyRunning(running, 'estimate');

      // A changed draft (or changed sources) becomes a new query version; an unchanged one is estimated again.
      let version = currentVersion(m);
      if (!version || draftChanged(m)) {
        const number = Math.max(0, ...m.versions.map((v) => v.version)) + 1;
        // The same display fingerprint as the version before, unless the sources changed since it was made.
        version = makeVersion(m.matter, number, m.draft.criteria, null, `Query v${number}`, version && !sourcesChanged(m, version.version) ? version.sources_fingerprint : undefined);
        m.sourcesAt[number] = sourcesFingerprint(m.matter);
        m.versions.push(version);
        m.matter.current_version = number;
        // A new query hasn't been previewed. (Not while an export is running: it carries on with its own version.)
        if (m.matter.stage === 'previewed' || m.matter.stage === 'exported') m.matter.stage = 'scoping';
        m.draft = { ...m.draft, based_on_version: number };
      }
      const target = version;
      return HttpResponse.json(
        createJob('estimate', m.matter.id, {
          finish: () => {
            // Estimating the same query again finds the same items, so a version keeps its counts.
            target.counts ??= estimateCounts(m, target.criteria);
            appendLog(m, 'estimate', `Query v${target.version} · ${target.counts.items.toLocaleString('en-US')} items + ${target.counts.partial_items.toLocaleString('en-US')} partially indexed`, target.version, { kql: target.kql, counts: target.counts });
            return { version: target.version, estimated_at: iso(), counts: clone(target.counts) };
          },
        }),
        { status: 202 },
      );
    }),
  ),
];
