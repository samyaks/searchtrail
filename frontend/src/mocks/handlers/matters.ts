// Matters and what is attached to them: details, custodians (with holds) and sites.
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { custodianFor, db, noHold, type MockMatter } from '../db';
import { deniedByPurview } from '../denied';
import { example } from '../examples';
import { appendLog, signedIn } from '../log';
import { findPerson, initialsOf } from '../people';
import { idParam, readJson, route, withMatter } from '../route';
import { scenario } from '../scenarios';
import { clone, error, iso, nextId, notFound, validationFailed } from '../util';
import { matterView, summaryOf } from '../views';

type S = Schemas;

const NUMBER = /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/;
const TYPES: S['MatterType'][] = ['investigation', 'litigation', 'regulatory', 'dsr'];
const STAGES: S['MatterStage'][] = ['scoping', 'previewed', 'exporting', 'exported'];

/** Pending hold changes finish the next time the matter is read ("Purview takes a moment"). */
function settleHolds(m: MockMatter) {
  for (const custodian of m.matter.custodians) {
    const target = m.settling[custodian.user_id];
    if (!target) continue;
    custodian.hold = target === 'on' ? { status: 'on', since: iso() } : noHold();
    delete m.settling[custodian.user_id];
  }
}

const findCustodian = (m: MockMatter, userId: string) => m.matter.custodians.find((c) => c.user_id === userId);
const sameUrl = (a: string, b: string) => a.replace(/\/+$/, '').toLowerCase() === b.replace(/\/+$/, '').toLowerCase();

export const matterHandlers = [
  route('get', '/matters', ({ url }) => {
    const stage = url.searchParams.get('stage');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    if (stage && !STAGES.includes(stage as S['MatterStage'])) return validationFailed('stage', `stage must be one of ${STAGES.join(', ')}.`);
    const items = db.matters
      .filter((m) => (!stage || m.matter.stage === stage) && (!q || `${m.matter.matter_number} ${m.matter.name}`.toLowerCase().includes(q)))
      .map(summaryOf);
    return HttpResponse.json({ items, total: items.length } satisfies S['MatterList']);
  }),

  route('post', '/matters', async ({ request }) => {
    const body = await readJson(request);
    if (!body) return validationFailed('body', 'The request body must be a JSON object.');
    const { matter_number: number, name, type, description = '' } = body;
    if (typeof number !== 'string' || !NUMBER.test(number)) return validationFailed('matter_number', 'matter_number must be letters, digits, dots, dashes or underscores.');
    if (typeof name !== 'string' || name.length < 1 || name.length > 200) return validationFailed('name', 'name must be between 1 and 200 characters.');
    if (typeof type !== 'string' || !TYPES.includes(type as S['MatterType'])) return validationFailed('type', `type must be one of ${TYPES.join(', ')}.`);
    if (typeof description !== 'string' || description.length > 2000) return validationFailed('description', 'description must be at most 2000 characters.');
    if (Object.keys(body).some((k) => !['matter_number', 'name', 'type', 'description'].includes(k))) return validationFailed('body', 'The request has fields the API does not accept.');
    if (db.matters.some((m) => m.matter.matter_number.toLowerCase() === number.toLowerCase())) {
      return error(409, 'conflict', `A matter with number ${number} already exists.`, { matter_number: number });
    }
    const created = iso();
    const matter: S['Matter'] = {
      id: nextId('mat'), matter_number: number, name, type: type as S['MatterType'], description, stage: 'scoping', purview_case_id: null,
      created_at: created, created_by: { id: signedIn().id, display_name: signedIn().display_name }, custodians: [], sites: [],
      current_version: null, previewed_version: null, last_previewed_at: null, draft_changed: false,
    };
    const entry: MockMatter = {
      matter, activityAt: created, sourcesChanged: false, preview: null, previewItems: [], termReport: null, exports: [], log: [], versions: [], settling: {},
      draft: {
        criteria: { keywords: [], keyword_mode: 'any', exclude_keywords: [], date_from: null, date_to: null, kinds: ['email', 'chats', 'docs'], file_extensions: [], participant_domains: [], exclude_participant_domains: [], label_ids: [], exclude_label_ids: [], doc_date_property: 'lastmodifiedtime', raw_kql: null },
        updated_at: created, based_on_version: null, changed_since_version: false,
      },
    };
    appendLog(entry, 'matter_created', `${number} · ${name}`);
    return HttpResponse.json(matterView(entry), { status: 201 });
  }),

  route('get', '/matters/:matterId', (context) =>
    withMatter(context, (m) => {
      settleHolds(m);
      return HttpResponse.json(matterView(m));
    }),
  ),

  route('patch', '/matters/:matterId', (context) =>
    withMatter(context, async (m) => {
      const body = await readJson(context.request);
      if (!body) return validationFailed('body', 'The request body must be a JSON object.');
      const allowed = ['name', 'type', 'description'];
      if (Object.keys(body).some((k) => !allowed.includes(k))) return validationFailed('body', 'Only name, type and description can be changed. The matter number cannot.');
      if ('name' in body && (typeof body.name !== 'string' || body.name.length < 1 || body.name.length > 200)) return validationFailed('name', 'name must be between 1 and 200 characters.');
      if ('type' in body && !TYPES.includes(body.type as S['MatterType'])) return validationFailed('type', `type must be one of ${TYPES.join(', ')}.`);
      if ('description' in body && (typeof body.description !== 'string' || body.description.length > 2000)) return validationFailed('description', 'description must be at most 2000 characters.');
      const changed = allowed.filter((k) => k in body && (m.matter as Record<string, unknown>)[k] !== body[k]);
      Object.assign(m.matter, Object.fromEntries(changed.map((k) => [k, body[k]])));
      if (changed.length) appendLog(m, 'matter_updated', `Changed the ${changed.join(' and ')}`);
      return HttpResponse.json(matterView(m));
    }),
  ),

  // -- custodians ---------------------------------------------------------------------------------------
  route('put', '/matters/:matterId/custodians/:userId', (context) =>
    withMatter(context, async (m) => {
      const userId = idParam(context, 'userId');
      const body = await readJson(context.request);
      if (!body || typeof body.mailbox !== 'boolean' || typeof body.onedrive !== 'boolean') return validationFailed('body', 'mailbox and onedrive must be true or false.');
      if ('sites' in body && (!Array.isArray(body.sites) || body.sites.some((s) => typeof s !== 'string'))) return validationFailed('sites', 'sites must be a list of web addresses.');
      const existing = findCustodian(m, userId);
      const person = findPerson(userId);
      if (!existing && !person) return notFound('person in the directory');
      const sites = Array.isArray(body.sites) ? (body.sites as string[]) : (existing?.sites ?? []);
      const custodian = existing ?? { ...custodianFor(0), user_id: person!.id, display_name: person!.display_name, email: person!.email, department: person!.department, initials: initialsOf(person!.display_name) };
      Object.assign(custodian, { mailbox: body.mailbox, onedrive: body.onedrive, sites: clone(sites) });
      if (!existing) m.matter.custodians.push(custodian);
      m.sourcesChanged = true;
      appendLog(m, existing ? 'custodian_updated' : 'custodian_added', `${custodian.display_name} · ${[custodian.mailbox && 'mailbox', custodian.onedrive && 'OneDrive'].filter(Boolean).join(' and ') || 'no sources'}`);
      return HttpResponse.json(clone(custodian));
    }),
  ),

  route('delete', '/matters/:matterId/custodians/:userId', (context) =>
    withMatter(context, (m) => {
      const custodian = findCustodian(m, idParam(context, 'userId'));
      if (!custodian) return notFound('custodian');
      if (custodian.hold.status === 'on' || custodian.hold.status === 'pending') {
        return error(409, 'conflict', `${custodian.display_name} is on hold. Release the hold before removing them.`, { user_id: custodian.user_id });
      }
      m.matter.custodians = m.matter.custodians.filter((c) => c !== custodian);
      m.sourcesChanged = true;
      appendLog(m, 'custodian_removed', custodian.display_name);
      return new HttpResponse(null, { status: 204 });
    }),
  ),

  route('put', '/matters/:matterId/custodians/:userId/hold', (context) =>
    withMatter(context, async (m) => {
      const custodian = findCustodian(m, idParam(context, 'userId'));
      if (!custodian) return notFound('custodian');
      const body = await readJson(context.request);
      if (!body || typeof body.on_hold !== 'boolean') return validationFailed('on_hold', 'on_hold must be true or false.');
      const denied = deniedByPurview('setCustodianHold');
      if (denied) return denied;
      if (scenario.holdFails) return HttpResponse.json(example<S['Error']>('setCustodianHold', '502'), { status: 502 });
      const already = body.on_hold ? custodian.hold.status === 'on' || custodian.hold.status === 'pending' : custodian.hold.status === 'off' || custodian.hold.status === 'releasing';
      if (!already) {
        custodian.hold = { status: body.on_hold ? 'pending' : 'releasing', since: custodian.hold.since };
        m.settling[custodian.user_id] = body.on_hold ? 'on' : 'off';
        appendLog(m, body.on_hold ? 'hold_placed' : 'hold_released', `${custodian.display_name} · ${body.on_hold ? 'hold requested' : 'release requested'}`);
      }
      return HttpResponse.json(clone(custodian));
    }),
  ),

  // -- sites without a custodian -------------------------------------------------------------------------
  route('post', '/matters/:matterId/sites', (context) =>
    withMatter(context, async (m) => {
      const body = await readJson(context.request);
      const url = typeof body?.url === 'string' ? body.url.trim() : '';
      const isHttps = (text: string) => {
        try {
          return new URL(text).protocol === 'https:';
        } catch {
          return false;
        }
      };
      if (!isHttps(url)) return validationFailed('url', 'url must be a web address that starts with https://.');
      const linked = m.matter.custodians.flatMap((c) => c.sites);
      if ([...m.matter.sites.map((s) => s.url), ...linked].some((u) => sameUrl(u, url))) return error(409, 'conflict', 'That site is already part of this matter.', { url });
      const site: S['Site'] = { id: nextId('site'), url };
      m.matter.sites.push(site);
      m.sourcesChanged = true;
      appendLog(m, 'site_added', url);
      return HttpResponse.json(site, { status: 201 });
    }),
  ),

  route('delete', '/matters/:matterId/sites/:siteId', (context) =>
    withMatter(context, (m) => {
      const site = m.matter.sites.find((s) => s.id === idParam(context, 'siteId'));
      if (!site) return notFound('site');
      m.matter.sites = m.matter.sites.filter((s) => s !== site);
      m.sourcesChanged = true;
      appendLog(m, 'site_removed', site.url);
      return new HttpResponse(null, { status: 204 });
    }),
  ),
];

