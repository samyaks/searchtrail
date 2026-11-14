// The mock backend as a screen will meet it: state that changes as it is used.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Schemas } from '@/api/client';
import { buildMockKql, CriteriaInvalid } from '@/mocks/kql';
import { PEOPLE } from '@/mocks/people';
import { setScenario } from '@/mocks/scenarios';
import { setNow } from '@/mocks/util';
import { ALEX, del, FALCON, get, HANNAH, patch, post, put, runJob } from './api';

const M = `/matters/${FALCON}`;
const OPTIONS = { include_partially_indexed: true, partially_indexed_scope: 'responsiveLocations', format: 'pst' };
const draft = async () => (await get(`${M}/draft`)).json as Schemas['Draft'];

describe('the matters list', () => {
  test('starts in the design\'s order, and a matter moves to the top when something happens to it', async () => {
    const ids = async () => ((await get('/matters')).json.items as { id: string }[]).map((m) => m.id);
    expect(await ids()).toEqual(['mat_falcon', 'mat_harlow', 'mat_brightwell', 'mat_q3trading', 'mat_travel']);
    await patch('/matters/mat_travel', { description: 'Reviewed.' });
    expect((await ids())[0]).toBe('mat_travel');
    const created = await post('/matters', { matter_number: 'M-1', name: 'Newest', type: 'dsr' });
    expect((await ids())[0]).toBe(created.json.id);
  });

  test('filters by stage and by text in the number or name', async () => {
    const list = async (query: Record<string, string>) => ((await get('/matters', query)).json.items as { name: string }[]).map((m) => m.name);
    expect(await list({ stage: 'exported' })).toEqual(['Brightwell supply contract dispute', 'Internal review: travel expenses']);
    expect(await list({ q: '0124' })).toEqual(['Regulator request: Q3 trading records']);
    expect(await list({ q: 'FALCON', stage: 'scoping' })).toEqual([]);
  });

  test('every matter has details that agree with its list entry', async () => {
    for (const entry of (await get('/matters')).json.items as Schemas['MatterSummary'][]) {
      const matter = (await get(`/matters/${entry.id}`)).json as Schemas['Matter'];
      expect(matter.custodians.length, entry.name).toBe(entry.custodian_count);
      expect(matter.stage, entry.name).toBe(entry.stage);
      expect(matter.current_version, entry.name).toBe(entry.current_version);
    }
  });
});

describe('editing the draft and estimating it', () => {
  test('a saved draft is what the next read returns, and marks the query as changed', async () => {
    expect((await draft()).changed_since_version).toBe(false);
    expect((await get(M)).json.draft_changed).toBe(false);
    const criteria = { ...(await draft()).criteria, keywords: ['invoic*', 'kickback'], keyword_mode: 'all' };
    expect((await put(`${M}/draft`, { criteria })).json.criteria.keywords).toEqual(['invoic*', 'kickback']);
    expect((await draft()).criteria.keyword_mode).toBe('all');
    expect((await draft()).changed_since_version).toBe(true);
    expect((await get(M)).json.draft_changed).toBe(true);
    expect((await get(`${M}/previews/latest`)).json.stale).toBe(true); // the preview is of the old query
  });

  test('an estimate is a job that makes a new version only when the draft changed', async () => {
    const same = await post(`${M}/estimates`);
    const states = await runJob(same.json.id);
    expect(states.at(-1).result.version).toBe(3); // nothing changed: v3 estimated again, with its own counts
    expect(states.at(-1).result.counts.items).toBe(630);
    expect((await get(`${M}/versions`)).json.items).toHaveLength(3);

    const criteria = { ...(await draft()).criteria, keywords: ['invoic*'] };
    await put(`${M}/draft`, { criteria });
    const changed = await post(`${M}/estimates`);
    expect((await get(M)).json.current_version).toBe(4); // the version exists as soon as the job starts
    const done = (await runJob(changed.json.id)).at(-1);
    expect(done.status).toBe('succeeded');
    expect(done.result.version).toBe(4);
    const matter = (await get(M)).json as Schemas['Matter'];
    expect(matter.draft_changed).toBe(false);
    expect(matter.stage).toBe('scoping'); // a new query hasn't been previewed
    const versions = (await get(`${M}/versions`)).json.items as Schemas['QueryVersion'][];
    expect(versions.map((v) => v.version)).toEqual([4, 3, 2, 1]);
    expect(versions[0]!.counts).toEqual(done.result.counts);
    expect((await get('/matters')).json.items[0]).toMatchObject({ id: FALCON, current_version: 4, latest_counts: { items: done.result.counts.items } });
  });

  test('the live KQL follows the criteria, and the contract\'s own criteria give the contract\'s own KQL', async () => {
    const falcon = (await draft()).criteria;
    expect((await post('/kql/preview', { criteria: falcon })).json.kql).toContain('"project falcon" OR invoic* OR kickback OR "side letter"');
    const custom = (await post('/kql/preview', { criteria: { ...falcon, keywords: ['alpha', 'beta gamma'], keyword_mode: 'all', exclude_keywords: ['spam'], date_from: null, date_to: null, file_extensions: [], exclude_participant_domains: [] } })).json;
    expect(custom.kql).toBe('("alpha" AND "beta gamma") AND NOT spam'.replace('"alpha"', 'alpha'));
    expect(custom.methodology).toContain('Containing ALL of these terms: alpha, "beta gamma".');
    expect(custom.length).toBe(custom.kql.length);
    expect(() => buildMockKql({ ...falcon, keywords: [], raw_kql: null })).toThrow(CriteriaInvalid);
  });
});

describe('jobs', () => {
  test('progress moves on every poll and the job ends with its result', async () => {
    const queued = (await post(`${M}/previews`)).json;
    expect(queued).toMatchObject({ kind: 'preview', status: 'queued', progress: 0, result: null });
    const states = await runJob(queued.id);
    expect(states.map((s) => [s.status, s.progress])).toEqual([['running', 0.33], ['running', 0.67], ['succeeded', 1]]);
    expect(states.at(-1).result.version).toBe(3);
    expect((await get(`/jobs/${queued.id}`)).json.status).toBe('succeeded'); // and stays that way
  });

  test('how long a job takes is a switch', async () => {
    setScenario({ jobPolls: 1 });
    const job = (await post(`${M}/previews`)).json;
    expect((await runJob(job.id)).map((s) => s.status)).toEqual(['succeeded']);
  });

  test('a running job is found again after a reload, and is no longer "active" once done', async () => {
    const job = (await post(`${M}/term-reports`)).json;
    await get(`/jobs/${job.id}`);
    expect(((await get(`${M}/jobs`, { active: true })).json.items as { id: string }[]).map((j) => j.id)).toEqual([job.id]);
    await runJob(job.id);
    expect((await get(`${M}/jobs`, { active: true })).json.items).toEqual([]);
    expect((await get(`${M}/jobs`, { kind: 'term_report' })).json.items).toHaveLength(1);
  });

  test('a second job of the same kind is refused and points at the first', async () => {
    const first = (await post(`${M}/previews`)).json;
    const second = await post(`${M}/previews`);
    expect(second.status).toBe(409);
    expect(second.json.details.job_id).toBe(first.id);
    expect((await post(`${M}/term-reports`)).status).toBe(202); // another kind is fine
  });

  test('a job a scenario fails ends as failed, with the contract\'s error, and changes nothing', async () => {
    setScenario({ failJobs: ['preview'], jobPolls: 2 });
    const before = (await get(`${M}/previews/latest`)).json;
    const job = (await post(`${M}/previews`)).json;
    const failed = (await runJob(job.id)).at(-1);
    expect(failed).toMatchObject({ status: 'failed', result: null, error: { code: 'purview_operation_failed' } });
    expect((await get(`${M}/previews/latest`)).json.id).toBe(before.id);
    expect((await post(`${M}/previews`)).status).toBe(202); // and it can be tried again
  });
});

describe('previews', () => {
  test('the item table adds up to the breakdowns, whichever bar you click', async () => {
    await runJob((await post(`${M}/previews`)).json.id);
    const preview = (await get(`${M}/previews/latest`)).json as Schemas['Preview'];
    const count = async (query: Record<string, string>) => (await get(`/previews/${preview.id}/items`, { ...query, page_size: 1 })).json.total as number;
    expect(await count({})).toBe(preview.report_items);
    for (const bar of preview.breakdowns.by_location) expect(await count({ location: bar.name }), bar.name).toBe(bar.count);
    for (const bar of preview.breakdowns.by_label) expect(await count({ label: bar.name }), bar.name).toBe(bar.count);
    const byType = { Email: 'email', 'Teams chat': 'teams_chat', Document: 'document' } as const;
    for (const bar of preview.breakdowns.by_type) expect(await count({ type: byType[bar.name as keyof typeof byType] }), bar.name).toBe(bar.count);
  });

  test('paging walks the whole list without repeats, and the CSV has every item', async () => {
    const preview = (await get(`${M}/previews/latest`)).json as Schemas['Preview'];
    const seen = new Set<string>();
    for (let page = 1; seen.size < preview.report_items; page += 1) {
      const reply = (await get(`/previews/${preview.id}/items`, { page, page_size: 200 })).json;
      for (const item of reply.items) seen.add(item.id);
      if (!reply.items.length) break;
    }
    expect(seen.size).toBe(preview.report_items);
    const csv = (await get(`/previews/${preview.id}/items.csv`)).text.trimEnd().split('\n');
    expect(csv).toHaveLength(preview.report_items + 1);
  });

  test('a preview of a re-estimated matter breaks down the new counts exactly', async () => {
    const criteria = { ...(await draft()).criteria, keywords: ['alpha'] };
    await put(`${M}/draft`, { criteria });
    await runJob((await post(`${M}/estimates`)).json.id);
    await runJob((await post(`${M}/previews`)).json.id);
    const preview = (await get(`${M}/previews/latest`)).json as Schemas['Preview'];
    const sum = (rows: { count: number }[]) => rows.reduce((n, r) => n + r.count, 0);
    for (const rows of Object.values(preview.breakdowns)) expect(sum(rows)).toBe(preview.counts.items + preview.counts.partial_items);
    expect(preview.stale).toBe(false);
    expect((await get(M)).json).toMatchObject({ stage: 'previewed', previewed_version: preview.version });
  });

  test('a term report compares with the one before', async () => {
    const before = (await get(`${M}/term-reports/latest`)).json as Schemas['TermReport'];
    await runJob((await post(`${M}/term-reports`)).json.id);
    const again = (await get(`${M}/term-reports/latest`)).json as Schemas['TermReport'];
    expect(again.id).not.toBe(before.id);
    expect(again.rows.map((r) => r.items)).toEqual(before.rows.map((r) => r.items)); // same query, same counts
    expect(again.rows.map((r) => r.previous_items)).toEqual(before.rows.map((r) => r.previous_items));
  });
});

describe('exports', () => {
  test('a changed query is blocked until it is previewed; the check and the export agree', async () => {
    expect((await post(`${M}/exports/check`)).json.ready).toBe(true);
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    await runJob((await post(`${M}/estimates`)).json.id);

    const check = (await post(`${M}/exports/check`)).json as Schemas['ExportCheck'];
    expect(check).toMatchObject({ ready: false, blocked_code: 'export_not_previewed', version: 4, previewed_version: 3 });
    expect(check.checks.map((c) => c.status)).toEqual(['failed', 'passed', 'skipped']);
    const start = await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' });
    expect(start.status).toBe(409);
    expect(start.json.code).toBe('export_not_previewed');

    await runJob((await post(`${M}/previews`)).json.id);
    expect((await post(`${M}/exports/check`)).json.ready).toBe(true);
  });

  test('changed sources block an export even for the previewed query', async () => {
    await put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: true });
    const check = (await post(`${M}/exports/check`)).json as Schemas['ExportCheck'];
    expect(check).toMatchObject({ ready: false, blocked_code: 'export_not_previewed' });
    expect(check.checks.map((c) => `${c.key}:${c.status}`)).toEqual(['previewed:passed', 'same_sources:failed', 'counts_unchanged:skipped']);
    expect((await get(M)).json.draft_changed).toBe(true);
  });

  test('new items since the preview block the export until the change is accepted, and the acceptance is recorded', async () => {
    setScenario({ exportCheck: 'countsChanged' });
    const check = (await post(`${M}/exports/check`)).json as Schemas['ExportCheck'];
    expect(check).toMatchObject({ ready: false, blocked_code: 'export_counts_changed' });
    expect(check.counts!.items).toBe(630 + 17);
    expect(check.checks.at(-1)!.message).toContain('630 → 647 items');
    const refused = await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' });
    expect(refused.json.code).toBe('export_counts_changed');
    const accepted = await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142', accept_changes: true });
    expect(accepted.status).toBe(202);
    await runJob(accepted.json.id);
    const exports = (await get(`${M}/exports`)).json.items as Schemas['Export'][];
    expect(exports[0]).toMatchObject({ changes_accepted: true, status: 'ready' });
    expect(((await get(`${M}/log`)).json.items as { action: string; details: { changes_accepted?: boolean } }[]).find((e) => e.action === 'export_started')!.details.changes_accepted).toBe(true);
  });

  test('the matter number must be typed exactly', async () => {
    const wrong = await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'm-2026-0142' });
    expect(wrong.status).toBe(422);
    expect(wrong.json).toMatchObject({ code: 'confirmation_mismatch', details: { expected: 'M-2026-0142' } });
  });

  test('an export runs, its progress shows in the list and on the export, and the matter finishes as exported', async () => {
    const started = (await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' })).json;
    expect((await get(M)).json.stage).toBe('exporting');
    const exportId = ((await get(`${M}/exports`)).json.items as Schemas['Export'][])[0]!.id;
    await get(`/jobs/${started.id}`);
    expect((await get(`/exports/${exportId}`)).json).toMatchObject({ status: 'preparing', progress: 0.33 });
    expect((await get('/matters')).json.items.find((m: { id: string }) => m.id === FALCON).export_progress).toBe(0.33);
    const done = (await runJob(started.id)).at(-1);
    expect(done.result).toMatchObject({ id: exportId, status: 'ready', progress: 1 });
    expect(done.result.files).toHaveLength(2);
    expect((await get(M)).json.stage).toBe('exported');
    expect((await get(`${M}/versions`)).json.items[0].exported).toBe(true);
  });

  test('a failed export job leaves the export failed and the matter previewed', async () => {
    setScenario({ failJobs: ['export'], jobPolls: 1 });
    const started = (await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' })).json;
    expect((await runJob(started.id)).at(-1).status).toBe('failed');
    expect(((await get(`${M}/exports`)).json.items as Schemas['Export'][])[0]).toMatchObject({ status: 'failed' });
    expect((await get(M)).json.stage).toBe('previewed');
  });

  test('hand-offs show their state on the export while they run and when they are done', async () => {
    const download = (await post('/exports/exp_falcon_v2/download')).json;
    await get(`/jobs/${download.id}`);
    expect((await get('/exports/exp_falcon_v2')).json.download).toMatchObject({ status: 'running', progress: 0.33 });
    await runJob(download.id);
    expect((await get('/exports/exp_falcon_v2')).json.download).toMatchObject({ status: 'done', progress: 1, stored_path: `matters/${FALCON}/exports/exp_falcon_v2` });
    const review = (await post('/exports/exp_falcon_v2/review-set', { review_set_name: 'M-2026-0142 review' })).json;
    await runJob(review.id);
    expect((await get('/exports/exp_falcon_v2')).json.review_set).toMatchObject({ status: 'done', name: 'M-2026-0142 review' });
    expect((await post('/exports/exp_falcon_v2/review-set', { review_set_name: ' ' })).status).toBe(400);
  });
});

describe('custodians, holds and sites', () => {
  test('a hold is pending when asked for and in place the next time the matter is read', async () => {
    await put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: true });
    expect((await put(`${M}/custodians/${HANNAH}/hold`, { on_hold: true })).json.hold.status).toBe('pending');
    const settled = ((await get(M)).json.custodians as Schemas['Custodian'][]).find((c) => c.user_id === HANNAH)!;
    expect(settled.hold.status).toBe('on');
    expect(settled.hold.since).not.toBeNull();
    expect((await del(`${M}/custodians/${HANNAH}`)).status).toBe(409); // release it first
    expect((await put(`${M}/custodians/${HANNAH}/hold`, { on_hold: false })).json.hold.status).toBe('releasing');
    expect(((await get(M)).json.custodians as Schemas['Custodian'][]).find((c) => c.user_id === HANNAH)!.hold.status).toBe('off');
    expect((await del(`${M}/custodians/${HANNAH}`)).status).toBe(204);
  });

  test('adding, changing and removing people and sites changes the matter, and the log says so', async () => {
    await put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: false, sites: ['https://contoso.sharepoint.com/sites/Finance'] });
    const matter = (await get(M)).json as Schemas['Matter'];
    expect(matter.custodians.map((c) => c.display_name)).toEqual(['Alex Wilber', 'Megan Bowen', 'Hannah Ortega']);
    expect(matter.custodians[2]).toMatchObject({ mailbox: true, onedrive: false, initials: 'HO' });
    const site = (await post(`${M}/sites`, { url: 'https://contoso.sharepoint.com/sites/Legal' })).json;
    expect((await post(`${M}/sites`, { url: 'https://contoso.sharepoint.com/sites/Finance' })).status).toBe(409); // already a site of the matter
    await del(`${M}/sites/${site.id}`);
    await del(`${M}/custodians/${ALEX}`);
    const actions = ((await get(`${M}/log`)).json.items as { action: string }[]).slice(0, 5).map((e) => e.action);
    expect(actions).toEqual(['custodian_removed', 'site_removed', 'site_added', 'custodian_added', 'term_report']);
  });
});

describe('the log', () => {
  test('is newest first, and each entry names the hash of the one before', async () => {
    await patch(`${M}`, { name: 'Renamed once' });
    await patch(`${M}`, { name: 'Renamed twice' });
    const all = ((await get(`${M}/log`)).json.items as Schemas['LogEntry'][]).slice().reverse(); // oldest first
    expect(all.map((e) => e.seq)).toEqual([...all.keys()].map((i) => i + 1));
    for (let i = 1; i < all.length; i += 1) expect(all[i]!.prev_hash, `entry ${all[i]!.seq}`).toBe(all[i - 1]!.hash);
    expect(all.at(-1)).toMatchObject({ action: 'matter_updated', actor: 'Dana Whitfield', actor_email: 'dana.whitfield@contoso.com' });
    const page = (await get(`${M}/log`, { page: 2, page_size: 3 })).json;
    expect(page).toMatchObject({ page: 2, page_size: 3, total: all.length });
    expect(page.items.map((e: { seq: number }) => e.seq)).toEqual([all.length - 3, all.length - 4, all.length - 5]);
  });

  test('verifies, or reports the first bad entry when the log was tampered with', async () => {
    const entries = ((await get(`${M}/log`)).json as { total: number }).total;
    expect((await post(`${M}/log/verify`)).json).toMatchObject({ ok: true, entries, first_bad_seq: null, message: `${entries} entries verified, chain intact` });
    setScenario({ logTampered: true });
    expect((await post(`${M}/log/verify`)).json).toMatchObject({ ok: false, first_bad_seq: 5, message: 'Entry 5: contents were modified after it was written' });
  });

  test('comparing two versions says what was added and removed', async () => {
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'], exclude_keywords: [] } });
    await runJob((await post(`${M}/estimates`)).json.id);
    const diff = (await get(`${M}/versions/compare`, { from: 3, to: 4 })).json as Schemas['VersionComparison'];
    expect(diff.changes.some((c) => c.change === 'added' && c.text.includes('alpha'))).toBe(true);
    expect(diff.changes.some((c) => c.change === 'removed' && c.text.includes('weekly digest'))).toBe(true);
    expect(diff.counts.delta).toBe(diff.counts.to_items! - diff.counts.from_items!);
    expect(diff.sources_changed).toBe(false);
  });
});

describe('time', () => {
  test('new things are stamped with the mock clock, which tests can fix', async () => {
    setNow(new Date('2030-01-02T03:04:05Z'));
    const matter = (await post('/matters', { matter_number: 'M-9', name: 'Clock', type: 'dsr' })).json;
    expect(matter.created_at).toBe('2030-01-02T03:04:05Z');
    expect(((await get(`/matters/${matter.id}/log`)).json.items as { ts: string }[])[0]!.ts).toBe('2030-01-02T03:04:05Z');
  });
});

describe('the sample people', () => {
  test('are the same six as the backend\'s dry-run directory, so mocks and `npm run dev:api` agree', () => {
    const source = readFileSync(resolve(__dirname, '../../../../backend/searchtrail/dryrun.py'), 'utf8');
    const block = source.slice(source.indexOf('SAMPLE_DIRECTORY = ['), source.indexOf(']\n', source.indexOf('SAMPLE_DIRECTORY = [')));
    const backend = [...block.matchAll(/"id": "([^"]+)", "displayName": "([^"]+)", "mail": "([^"]+)",\s+"department": "([^"]+)"/g)].map((m) => ({ id: m[1], display_name: m[2], email: m[3], department: m[4] }));
    expect(backend).toHaveLength(6);
    expect(PEOPLE.map((p) => ({ ...p }))).toEqual(backend);
  });
});

describe('versions and sources', () => {
  test('a version made after the sources changed says so when compared', async () => {
    await put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: true });
    await runJob((await post(`${M}/estimates`)).json.id); // v4: the sources changed since v3
    const diff = (await get(`${M}/versions/compare`, { from: 3, to: 4 })).json as Schemas['VersionComparison'];
    expect(diff.sources_changed).toBe(true);
    await runJob((await post(`${M}/estimates`)).json.id); // estimating v4 again makes no new version
    expect(((await get(`${M}/versions`)).json.items as unknown[]).length).toBe(4);
  });
});
