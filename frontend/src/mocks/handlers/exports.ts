// Exports: the checks that guard them, starting one, and the two hand-offs (download, Purview review set).
import { HttpResponse } from 'msw';
import type { Schemas } from '@/api/client';
import { db, type MockMatter } from '../db';
import { deniedByPurview, throttledByMicrosoft } from '../denied';
import { appendLog, signedIn } from '../log';
import { exportJobBehaviour } from '../exportJob';
import { alreadyRunning, activeJob, createJob } from '../jobs';
import { idParam, readJson, route, withMatter } from '../route';
import { scenario } from '../scenarios';
import { clone, error, iso, nextId, notFound, validationFailed } from '../util';
import { currentVersion, sourcesChanged } from '../views';

type S = Schemas;
const user = () => ({ id: signedIn().id, display_name: signedIn().display_name });
const n = (value: number) => value.toLocaleString('en-US');
/** The new items an export check finds when the `countsChanged` scenario is on. */
const NEW_ITEMS = 17;

/** The checks a real export runs, in the contract's shape. Shared by POST .../exports/check and POST .../exports. */
export function exportCheck(m: MockMatter): S['ExportCheck'] {
  const version = currentVersion(m);
  const preview = m.preview;
  const previewed = !!version && !!preview && preview.version === version.version;
  const sameSources = !preview || !sourcesChanged(m, preview.version);
  const base = {
    version: version?.version ?? null, previewed_version: preview?.version ?? null, previewed_at: preview?.created_at ?? null, checked_at: iso(),
  };
  const when = preview ? new Date(preview.created_at).toISOString().slice(11, 16) : '';

  if (!previewed) {
    // The backend's wording (app/jobs/export_checks.py), including a matter that has no query yet.
    return {
      ready: false, blocked_code: 'export_not_previewed', ...base, counts: null,
      checks: [
        version
          ? { key: 'previewed', status: 'failed', message: `Query v${version.version} hasn't been previewed. Preview it first, so the export matches what was reviewed.` }
          : { key: 'previewed', status: 'failed', message: "There's no query to export yet. Estimate and preview one first." },
        !preview
          ? { key: 'same_sources', status: 'skipped', message: 'Not checked because nothing has been previewed.' }
          : sameSources
            ? { key: 'same_sources', status: 'passed', message: 'Same custodians and sites as the preview.' }
            : { key: 'same_sources', status: 'failed', message: 'The custodians or sites changed since the preview. Preview again, so the export matches what was reviewed.' },
        { key: 'counts_unchanged', status: 'skipped', message: "Not checked because the query wasn't previewed." },
      ],
    };
  }
  if (!sameSources) {
    return {
      ready: false, blocked_code: 'export_not_previewed', ...base, counts: null,
      checks: [
        { key: 'previewed', status: 'passed', message: `This exact query (v${version!.version}) was previewed at ${when}.` },
        { key: 'same_sources', status: 'failed', message: 'The custodians or sites changed since the preview. Preview again, so the export matches what was reviewed.' },
        { key: 'counts_unchanged', status: 'skipped', message: 'Not checked because the custodians or sites changed.' },
      ],
    };
  }
  const counts = clone(preview!.counts);
  if (scenario.exportCheck === 'countsChanged') {
    const now = { ...counts, items: counts.items + NEW_ITEMS };
    return {
      ready: false, blocked_code: 'export_counts_changed', ...base, counts: now,
      checks: [
        { key: 'previewed', status: 'passed', message: `This exact query (v${version!.version}) was previewed at ${when}.` },
        { key: 'same_sources', status: 'passed', message: 'Same custodians and sites as the preview.' },
        { key: 'counts_unchanged', status: 'failed', message: `Counts changed since the preview: ${n(counts.items)} → ${n(now.items)} items. Preview again, or accept the change explicitly (it's logged).` },
      ],
    };
  }
  return {
    ready: true, blocked_code: null, ...base, counts,
    checks: [
      { key: 'previewed', status: 'passed', message: `This exact query (v${version!.version}) was previewed at ${when}.` },
      { key: 'same_sources', status: 'passed', message: 'Same custodians and sites as the preview.' },
      { key: 'counts_unchanged', status: 'passed', message: `Counts unchanged since the preview (re-checked ${new Date().toISOString().slice(11, 16)}).` },
    ],
  };
}

/**
 * The export's name in Purview, as the backend makes it (searchtrail/workflow.py): the matter number, EVERLAW and
 * the time it starts to the second, `M-2026-0142 EVERLAW 20261125T143012Z`. A retry soon after a failed export so
 * gets its own name. Two in the same second (only the frozen clock of the tests) get -2, -3 after the time.
 */
export function exportName(m: MockMatter, stamp: string): string {
  const base = `${m.matter.matter_number} EVERLAW ${stamp.replace(/[-:]/g, '').slice(0, 15)}Z`;
  const taken = new Set(m.exports.map((e) => e.name));
  let name = base;
  for (let i = 2; taken.has(name); i += 1) name = `${base}-${i}`;
  return name;
}

const findExport = (id: string) => {
  for (const m of db.matters) {
    const found = m.exports.find((e) => e.id === id);
    if (found) return { m, found };
  }
  return undefined;
};

const OPTION_KEYS = ['include_partially_indexed', 'partially_indexed_scope', 'format', 'include_cloud_attachments', 'teams_transcripts'];
function optionsProblem(options: unknown): string | null {
  if (!options || typeof options !== 'object') return 'options must be an object.';
  const o = options as Record<string, unknown>;
  if (typeof o.include_partially_indexed !== 'boolean') return 'include_partially_indexed must be true or false.';
  if (o.format !== 'pst' && o.format !== 'msg') return 'format must be pst or msg.';
  if (Object.keys(o).some((k) => !OPTION_KEYS.includes(k))) return 'options has fields the API does not accept.';
  return null;
}

/** A hand-off (download, review set) needs a finished export, a free job slot and Purview's permission. */
function handoffBlocked(m: MockMatter, exp: S['Export'], kind: 'download' | 'review_set') {
  const denied = deniedByPurview(kind === 'download' ? 'startExportDownload' : 'startReviewSetHandoff');
  if (denied) return denied;
  if (exp.status !== 'ready') return error(409, 'conflict', "The export isn't ready yet. Wait for Purview to finish it.", { export_id: exp.id });
  const running = activeJob(m.matter.id, kind);
  return running ? alreadyRunning(running, kind === 'download' ? 'download' : 'review set hand-off') : undefined;
}

export const exportHandlers = [
  route('post', '/matters/:matterId/exports/check', (context) => withMatter(context, (m) => throttledByMicrosoft('checkExport') ?? HttpResponse.json(exportCheck(m)))),

  route('get', '/matters/:matterId/exports', (context) => withMatter(context, (m) => HttpResponse.json({ items: clone(m.exports) } satisfies S['ExportList']))),

  route('post', '/matters/:matterId/exports', (context) =>
    withMatter(context, async (m) => {
      const body = await readJson(context.request);
      if (!body) return validationFailed('body', 'The request body must be a JSON object.');
      const problem = optionsProblem(body.options);
      if (problem) return validationFailed('options', problem);
      if (typeof body.confirm_matter_number !== 'string') return validationFailed('confirm_matter_number', 'Type the matter number to confirm the export.');
      if ('accept_changes' in body && typeof body.accept_changes !== 'boolean') return validationFailed('accept_changes', 'accept_changes must be true or false.');

      // The same order as the backend: nothing reaches Purview unless the checks pass.
      const check = exportCheck(m);
      if (check.blocked_code === 'export_not_previewed') return error(409, 'export_not_previewed', "This exact query and set of sources hasn't been previewed. Preview it first, so the export matches what was reviewed.", { version: check.version, previewed_version: check.previewed_version });
      if (check.blocked_code === 'export_counts_changed' && body.accept_changes !== true) {
        return error(409, 'export_counts_changed', 'Counts changed since the preview. Preview again, or accept the change explicitly (it is logged).', { preview_items: m.preview!.counts.items, now_items: check.counts!.items });
      }
      if (body.confirm_matter_number !== m.matter.matter_number) {
        return error(422, 'confirmation_mismatch', `Type ${m.matter.matter_number} exactly to confirm the export.`, { expected: m.matter.matter_number });
      }
      const running = activeJob(m.matter.id, 'export');
      if (running) return alreadyRunning(running, 'export');

      const counts = check.counts!;
      const stamp = iso();
      const exp: S['Export'] = {
        id: nextId('exp'), matter_id: m.matter.id, name: exportName(m, stamp), version: check.version!, status: 'preparing', progress: 0,
        counts, options: body.options as S['ExportOptions'], changes_accepted: check.blocked_code === 'export_counts_changed', started_at: stamp, started_by: user(),
        finished_at: null, expires_at: null, files: [], download: { status: 'none', progress: null, stored_path: null, finished_at: null }, review_set: { status: 'none', name: null, finished_at: null },
      };
      const stageBefore = m.matter.stage;
      m.exports.unshift(exp);
      m.matter.stage = 'exporting';
      appendLog(m, 'export_started', `${exp.name} · ${n(counts.items)} items + ${n(counts.partial_items)} partially indexed`, exp.version, { options: exp.options, counts, changes_accepted: exp.changes_accepted });
      return HttpResponse.json(
        createJob('export', m.matter.id, { ...exportJobBehaviour(m, exp, stageBefore), exportId: exp.id }),
        { status: 202 },
      );
    }),
  ),

  route('get', '/exports/:exportId', (context) => {
    const hit = findExport(idParam(context, 'exportId'));
    return hit ? HttpResponse.json(clone(hit.found)) : notFound('export');
  }),

  route('post', '/exports/:exportId/download', (context) => {
    const hit = findExport(idParam(context, 'exportId'));
    if (!hit) return notFound('export');
    const { m, found: exp } = hit;
    const blocked = handoffBlocked(m, exp, 'download');
    if (blocked) return blocked;
    return HttpResponse.json(
      createJob('download', m.matter.id, {
        onProgress: (progress) => {
          if (progress < 1) exp.download = { status: 'running', progress, stored_path: null, finished_at: null };
        },
        onFail: () => {
          exp.download = { status: 'failed', progress: null, stored_path: null, finished_at: null };
        },
        finish: () => {
          exp.download = { status: 'done', progress: 1, stored_path: `matters/${m.matter.id}/exports/${exp.id}`, finished_at: iso() };
          appendLog(m, 'export_downloaded', `${exp.name} · stored in SearchTrail`, exp.version, { stored_path: exp.download.stored_path });
          return clone(exp);
        },
      }),
      { status: 202 },
    );
  }),

  route('post', '/exports/:exportId/review-set', async (context) => {
    const hit = findExport(idParam(context, 'exportId'));
    if (!hit) return notFound('export');
    const { m, found: exp } = hit;
    const body = await readJson(context.request);
    const name = typeof body?.review_set_name === 'string' ? body.review_set_name.trim() : '';
    if (name.length < 1 || name.length > 200) return validationFailed('review_set_name', 'review_set_name must be between 1 and 200 characters.');
    const blocked = handoffBlocked(m, exp, 'review_set');
    if (blocked) return blocked;
    return HttpResponse.json(
      createJob('review_set', m.matter.id, {
        onProgress: (progress) => {
          if (progress < 1) exp.review_set = { status: 'running', name, finished_at: null };
        },
        onFail: () => {
          exp.review_set = { status: 'failed', name, finished_at: null };
        },
        finish: () => {
          exp.review_set = { status: 'done', name, finished_at: iso() };
          appendLog(m, 'review_set_added', `${exp.name} · review set ${name}`, exp.version, { review_set_name: name });
          return clone(exp);
        },
      }),
      { status: 202 },
    );
  }),
];
