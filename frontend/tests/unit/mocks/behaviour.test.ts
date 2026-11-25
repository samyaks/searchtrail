// The mock backend as a screen will meet it: state that changes as it is used.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { Schemas } from '@/api/client';
import { example } from '@/mocks/examples';
import { SEEDED_EXPORT_SECONDS } from '@/mocks/jobs';
import { buildMockKql, CriteriaInvalid } from '@/mocks/kql';
import { PEOPLE } from '@/mocks/people';
import { setScenario } from '@/mocks/scenarios';
import { setNow } from '@/mocks/util';
import { ALEX, del, FALCON, get, HANNAH, patch, post, put, runJob, tick } from './api';

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
    const custom = (await post('/kql/preview', { criteria: { ...falcon, keywords: ['alpha', 'beta gamma'], keyword_mode: 'all', exclude_keywords: ['spam'], date_from: null, date_to: null, file_extensions: [], exclude_participant_domains: [], exclude_label_ids: [] } })).json;
    expect(custom.kql).toBe('(alpha AND "beta gamma") AND (kind:email OR (kind:microsoftteams OR kind:im) OR kind:docs) AND NOT spam');
    expect(custom.methodology).toContain('Containing ALL of these terms: alpha, "beta gamma".');
    expect(custom.length).toBe(custom.kql.length);
    expect(() => buildMockKql({ ...falcon, keywords: [], raw_kql: null })).toThrow(CriteriaInvalid);
  });

  test('raw KQL whose parentheses or quotes don\'t pair up is refused, as the backend refuses it', async () => {
    const falcon = (await draft()).criteria;
    const refused = await post('/kql/preview', { criteria: { ...falcon, raw_kql: 'invoice) OR (kind:email' } });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: 'criteria_invalid', message: expect.stringContaining('closes a parenthesis it never opened') });
    expect(() => buildMockKql({ ...falcon, raw_kql: '"side letter' })).toThrow('has a quote that is never closed');
    expect(() => buildMockKql({ ...falcon, raw_kql: '(a OR b' })).toThrow('opens a parenthesis it never closes');
    expect(buildMockKql({ ...falcon, keywords: ['x'], raw_kql: '"pay (net 30)" OR (a AND b)' }).kql).toContain('("pay (net 30)" OR (a AND b))');
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
    setScenario({ jobSeconds: 30 });
    const job = (await post(`${M}/previews`)).json;
    tick(15);
    expect(await get(`/jobs/${job.id}`).then((r) => [r.json.status, r.json.progress])).toEqual(['running', 0.5]);
    tick(14);
    expect((await get(`/jobs/${job.id}`)).json.status).toBe('running');
    tick(1);
    expect((await get(`/jobs/${job.id}`)).json.status).toBe('succeeded');
  });

  test('asking about a job never moves it: only the clock does', async () => {
    const job = (await post(`${M}/previews`)).json;
    for (let i = 0; i < 5; i += 1) expect(await get(`/jobs/${job.id}`).then((r) => [r.json.status, r.json.progress])).toEqual(['queued', 0]);
    tick(3);
    // Five components polling the same job, or a double render, see the same thing.
    for (let i = 0; i < 5; i += 1) expect(await get(`/jobs/${job.id}`).then((r) => [r.json.status, r.json.progress])).toEqual(['running', 0.33]);
  });

  test('a job that is due has finished, whatever endpoint is read next', async () => {
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    const job = (await post(`${M}/estimates`)).json;
    const logged = async () => ((await get(`${M}/log`)).json.items as { action: string }[]).some((e) => e.action === 'estimate');
    const before = ((await get(`${M}/log`)).json.items as unknown[]).length;
    tick(10); // past the end of the job; the job itself is never asked about
    expect(((await get(`${M}/log`)).json.items as unknown[]).length).toBe(before + 1);
    expect(await logged()).toBe(true);
    expect((await get(`${M}/jobs`, { active: true })).json.items).toEqual([]);
    expect((await get('/matters')).json.items[0].latest_counts).not.toBeNull();
    expect((await get(`/jobs/${job.id}`)).json.status).toBe('succeeded');
  });

  test('a running job is found again after a reload, and is no longer "active" once done', async () => {
    const job = (await post(`${M}/term-reports`)).json;
    tick(3);
    expect(((await get(`${M}/jobs`, { active: true })).json.items as { id: string; status: string }[]).map((j) => [j.id, j.status])).toEqual([[job.id, 'running']]);
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
    setScenario({ failJobs: ['preview'] });
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
    const criteria = { ...(await draft()).criteria, keywords: ['payment'] };
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
    expect(again).toMatchObject({ version: 3, stale: false });
    expect((await get(`${M}/versions`)).json.items).toHaveLength(3); // an unchanged draft is counted as the version it is
  });

  test('a term report of a changed draft counts it as a new query version, compared with the report before', async () => {
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['project falcon', 'invoic*', 'kickback', 'side letter', 'bribe'] } });
    const job = (await post(`${M}/term-reports`)).json;
    // Another count while this one runs is refused, and makes no version of its own.
    expect((await post(`${M}/term-reports`)).status).toBe(409);
    expect((await get(M)).json).toMatchObject({ current_version: 4, draft_changed: false });
    expect(((await get(`${M}/versions`)).json.items as Schemas['QueryVersion'][]).map((v) => v.version).sort()).toEqual([1, 2, 3, 4]);

    const report = (await runJob(job.id)).at(-1).result as Schemas['TermReport'];
    expect(report).toMatchObject({ version: 4, stale: false });
    expect(report.rows.map((r) => [r.term, r.previous_items, r.previous_version])).toEqual([
      ['"project falcon"', 105, 3],
      ['invoic*', 440, 3],
      ['kickback', 258, 3],
      ['"side letter"', 316, 3],
      ['bribe', null, 3],
    ]);
    expect((await get(`${M}/term-reports/latest`)).json).toMatchObject({ id: report.id, version: 4, stale: false });
    // All terms together is what an estimate of v4 finds.
    const estimated = (await runJob((await post(`${M}/estimates`)).json.id)).at(-1).result;
    expect(estimated.version).toBe(4);
    expect(report.combined.items).toBe(estimated.counts.items);
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
    tick(3);
    expect((await get(`/exports/${exportId}`)).json).toMatchObject({ status: 'preparing', progress: 0.33 }); // nobody polled the job: the export still moved
    expect((await get('/matters')).json.items.find((m: { id: string }) => m.id === FALCON).export_progress).toBe(0.33);
    const done = (await runJob(started.id)).at(-1);
    expect(done.result).toMatchObject({ id: exportId, status: 'ready', progress: 1 });
    expect(done.result.files).toHaveLength(2);
    expect((await get(M)).json.stage).toBe('exported');
    expect((await get(`${M}/versions`)).json.items[0].exported).toBe(true);
  });

  test('a failed export job leaves the export failed and the matter previewed', async () => {
    setScenario({ failJobs: ['export'] });
    const started = (await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' })).json;
    expect((await runJob(started.id)).at(-1).status).toBe('failed');
    expect(((await get(`${M}/exports`)).json.items as Schemas['Export'][])[0]).toMatchObject({ status: 'failed' });
    expect((await get(M)).json.stage).toBe('previewed');
  });

  test('hand-offs show their state on the export while they run and when they are done', async () => {
    const download = (await post('/exports/exp_falcon_v2/download')).json;
    tick(3);
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

describe('what counts as a change', () => {
  test('the same criteria in another key order are not a change', async () => {
    const current = await draft();
    const reordered = Object.fromEntries(Object.entries(current.criteria).reverse());
    await put(`${M}/draft`, { criteria: reordered });
    expect((await get(M)).json.draft_changed).toBe(false);
    expect((await get(`${M}/previews/latest`)).json.stale).toBe(false);
    // ...and the live KQL is the contract's own for those criteria, whichever way round they are written.
    expect((await post('/kql/preview', { criteria: reordered })).json.kql).toBe((await post('/kql/preview', { criteria: current.criteria })).json.kql);
    const job = await post(`${M}/estimates`);
    expect((await runJob(job.json.id)).at(-1).result.version).toBe(3); // no new version for a re-ordered draft
  });

  test('a different order of the terms is a change: it can change the query', async () => {
    const current = await draft();
    await put(`${M}/draft`, { criteria: { ...current.criteria, keywords: [...current.criteria.keywords].reverse() } });
    expect((await get(M)).json.draft_changed).toBe(true);
  });

  test('undoing a change to the sources undoes it', async () => {
    await del(`${M}/custodians/${ALEX}`);
    expect((await get(M)).json.draft_changed).toBe(true);
    expect((await post(`${M}/exports/check`)).json.ready).toBe(false);
    await put(`${M}/custodians/${ALEX}`, { mailbox: true, onedrive: true }); // back as they were
    expect((await get(M)).json.draft_changed).toBe(false);
    expect((await post(`${M}/exports/check`)).json.ready).toBe(true);
  });

  test('a new version made after undoing a change is not reported as a change of sources', async () => {
    await del(`${M}/custodians/${ALEX}`);
    await put(`${M}/custodians/${ALEX}`, { mailbox: true, onedrive: true });
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    await runJob((await post(`${M}/estimates`)).json.id);
    expect(((await get(`${M}/versions/compare`, { from: 3, to: 4 })).json as Schemas['VersionComparison']).sources_changed).toBe(false);
  });
});

describe('seeded data adds up', () => {
  test('every matter that has a preview has one whose breakdowns total its items, and match its counts', async () => {
    let checked = 0;
    for (const entry of (await get('/matters')).json.items as Schemas['MatterSummary'][]) {
      const reply = await get(`/matters/${entry.id}/previews/latest`);
      if (reply.status === 404) continue;
      const preview = reply.json as Schemas['Preview'];
      expect(preview.report_items, entry.name).toBe(preview.counts.items + preview.counts.partial_items);
      for (const [name, rows] of Object.entries(preview.breakdowns)) {
        expect((rows as { count: number }[]).reduce((n, r) => n + r.count, 0), `${entry.name} ${name}`).toBe(preview.report_items);
      }
      expect(preview.counts.items, entry.name).toBe(entry.latest_counts!.items);
      expect((await get(`/previews/${preview.id}/items`, { page_size: 1 })).json.total, entry.name).toBe(preview.report_items);
      checked += 1;
    }
    expect(checked).toBe(4); // Falcon, Brightwell, Q3 trading and travel expenses
  });
});

describe('the stage of a matter', () => {
  test('an estimate while an export runs leaves the stage alone, and the export then settles it for its own version', async () => {
    setScenario({ jobSeconds: 60 }); // the export takes a minute, the estimate nine seconds
    await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' });
    setScenario({ jobSeconds: 9 });
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    await runJob((await post(`${M}/estimates`)).json.id);
    expect((await get(M)).json).toMatchObject({ stage: 'exporting', current_version: 4 });
    tick(60);
    // The export finished, but for v3: the matter's query is v4, which hasn't been previewed.
    expect((await get(M)).json.stage).toBe('scoping');
  });

  test('a failed export puts the stage back as it was', async () => {
    setScenario({ failJobs: ['export'] });
    const exportJob = (await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' })).json;
    expect((await get(M)).json.stage).toBe('exporting');
    await runJob(exportJob.id);
    expect((await get(M)).json.stage).toBe('previewed');
  });

  test('a changed query takes a previewed matter back to scoping', async () => {
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    await runJob((await post(`${M}/estimates`)).json.id);
    expect((await get(M)).json.stage).toBe('scoping');
  });
});

describe('the live KQL', () => {
  test('a date range with one end has one clause per item type, not a wildcard', async () => {
    const criteria = { ...(await draft()).criteria, keywords: ['alpha'], exclude_keywords: [], file_extensions: [], exclude_participant_domains: [], exclude_label_ids: [], kinds: ['email', 'docs'] };
    const from = (await post('/kql/preview', { criteria: { ...criteria, date_from: '2024-01-01', date_to: null } })).json.kql as string;
    const to = (await post('/kql/preview', { criteria: { ...criteria, date_from: null, date_to: '2025-06-30' } })).json.kql as string;
    expect(from).toBe('alpha AND ((kind:email AND (sent>=2024-01-01 OR received>=2024-01-01)) OR (kind:docs AND lastmodifiedtime>=2024-01-01))');
    expect(to).toBe('alpha AND ((kind:email AND (sent<=2025-06-30 OR received<=2025-06-30)) OR (kind:docs AND lastmodifiedtime<=2025-06-30))');
    expect(`${from}${to}`).not.toContain('*');
  });

  test('as the backend builds it: dates by item type, domains on mail and chats only, label exclusions kept', async () => {
    const falcon = (await draft()).criteria;
    const edited = { ...falcon, keywords: [...falcon.keywords, 'brightline'], doc_date_property: 'created' as const, participant_domains: ['contoso.com'] };
    const { kql, methodology, warnings } = (await post('/kql/preview', { criteria: edited })).json as Schemas['KqlPreview'];
    expect(kql).toBe(
      '("project falcon" OR invoic* OR kickback OR "side letter" OR brightline) AND ' +
        '((kind:email AND ((sent>=2024-01-01 AND sent<=2025-06-30) OR (received>=2024-01-01 AND received<=2025-06-30)) AND participants:contoso.com AND NOT participants:newsletters.contoso.com) OR ' +
        '((kind:microsoftteams OR kind:im) AND ((sent>=2024-01-01 AND sent<=2025-06-30) OR (received>=2024-01-01 AND received<=2025-06-30)) AND participants:contoso.com AND NOT participants:newsletters.contoso.com) OR ' +
        '(kind:docs AND (created>=2024-01-01 AND created<=2025-06-30) AND (fileextension:docx OR fileextension:xlsx OR fileextension:pptx OR fileextension:pdf))) AND ' +
        'NOT InformationProtectionLabelId:11111111-1111-4111-8111-111111111111 AND NOT "weekly digest"',
    );
    expect(kql).not.toMatch(/kind:docs[^)]*participants/); // a domain filter never drops documents
    expect(methodology).toEqual([
      'Item types: emails, Teams chats, documents.',
      'Date range from 2024-01-01 to 2025-06-30 (inclusive): emails/chats by sent or received date; documents by created date.',
      'Containing ANY of these terms: "project falcon", invoic*, kickback, "side letter", brightline.',
      'Terms ending in * match any word starting with that stem.',
      'Excluding items containing any of: "weekly digest".',
      'Emails/chats limited to those with a participant at: contoso.com. Documents are not filtered by domain.',
      'Emails/chats excluded if a participant is at: newsletters.contoso.com.',
      'Documents limited to file types: docx, xlsx, pptx, pdf.',
      'Excluding items with these sensitivity labels: Public.',
    ]);
    expect(warnings).toEqual(['Domain filters apply to emails and chats only. Documents are not filtered by domain.']);
  });

  test('a From date after the To date is refused, and nothing is estimated', async () => {
    const backwards = { ...(await draft()).criteria, date_from: '2026-01-01', date_to: '2025-06-30' };
    const refused = await post('/kql/preview', { criteria: backwards });
    expect(refused.status).toBe(422);
    expect(refused.json).toMatchObject({ code: 'criteria_invalid', message: expect.stringContaining('is after the To date'), details: { field: 'date_from' } });
    await put(`${M}/draft`, { criteria: backwards });
    const estimate = await post(`${M}/estimates`);
    expect(estimate.status).toBe(422);
    expect(estimate.json.code).toBe('criteria_invalid');
    expect((await get(`${M}/versions`)).json.items).toHaveLength(3); // no new version, no counts
  });
});

describe('counts that behave like a real search', () => {
  const report = async () => {
    const job = (await post(`${M}/term-reports`)).json;
    return (await runJob(job.id)).at(-1).result as Schemas['TermReport'];
  };
  const estimate = async (keywords: string[]) => {
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords } });
    const job = (await post(`${M}/estimates`)).json;
    return (await runJob(job.id)).at(-1).result.counts.items as number;
  };
  const FALCON_TERMS = ['project falcon', 'invoic*', 'kickback', 'side letter'];

  test('adding an OR term never lowers the total or another term\'s hits; removing one never raises them', async () => {
    const seeded = (await get(`${M}/term-reports/latest`)).json as Schemas['TermReport'];
    const hits = (r: Schemas['TermReport']) => Object.fromEntries(r.rows.map((row) => [row.term, row.items]));

    const more = await estimate([...FALCON_TERMS, 'brightline']);
    expect(more).toBeGreaterThan(630);
    const withMore = await report();
    expect(withMore.combined.items).toBe(more);
    expect(hits(withMore)).toMatchObject(hits(seeded)); // 105, 440, 258 and 316 stay as they were
    expect(hits(withMore).brightline).toBeGreaterThan(0);

    const fewer = await estimate(['project falcon', 'invoic*', 'kickback']);
    expect(fewer).toBeLessThan(630);
    expect(hits(await report())).toEqual({ '"project falcon"': 105, 'invoic*': 440, kickback: 258 });

    // Back to v3's own terms: the same 630 as the contract's example, every time.
    expect(await estimate(FALCON_TERMS)).toBe(630);
    expect(await estimate([...FALCON_TERMS, 'brightline'])).toBe(more);
  });

  test('a term the seeded items do not contain finds nothing, so adding it changes nothing', async () => {
    expect(await estimate([...FALCON_TERMS, 'zzznomatch'])).toBe(630);
    const rows = Object.fromEntries((await report()).rows.map((row) => [row.term, row.items]));
    expect(rows).toMatchObject({ '"project falcon"': 105, 'invoic*': 440, kickback: 258, '"side letter"': 316, zzznomatch: 0 });
    expect(await estimate(['zzznomatch'])).toBe(0);
    // Known words find items: alone, as a stem with *, in a phrase (its small words aside), and the matter's own name.
    for (const term of ['payment', 'paym*', 'wire transfer', 'the steering committee', 'investigation']) {
      expect(await estimate([term]), term).toBeGreaterThan(0);
    }
    // A phrase with an unknown word, or a stem no known word starts with, finds nothing.
    for (const term of ['wire zzznomatch', 'zzz*']) expect(await estimate([term]), term).toBe(0);
    // The same every time.
    expect(await estimate([...FALCON_TERMS, 'brightline', 'zzznomatch'])).toBe(await estimate([...FALCON_TERMS, 'brightline']));
  });

  test('what the demo shows can be searched for: words of the items\' titles, the custodians and sites, and investigation words', async () => {
    // From the seeded items' titles ("RE: Side letter, please do not forward", "Invoice INV-20931 Brightline.pdf"), the
    // custodians and their departments, the sites, and a few words an investigation looks for.
    const found = ['forward', 'do not forward', 'Megan Bowen', 'Alex Wilber', 'procurement', 'ProjectFalcon', 'finance', 'fraud', 'bribe*', 'cash', 'email', 'INV-20931', 'hotline'];
    for (const term of found) expect(await estimate([term]), term).toBeGreaterThan(0);
    // Adding any of them to v3's terms never lowers its 630, and the seeded terms keep their hits.
    for (const term of ['forward', 'Megan Bowen', 'fraud']) expect(await estimate([...FALCON_TERMS, term]), term).toBeGreaterThanOrEqual(630);
    expect(await estimate(FALCON_TERMS)).toBe(630);
  });

  test('hits do not depend on case, as in Purview', async () => {
    const lower = await estimate(['brightline']);
    expect(await estimate(['BRIGHTLINE'])).toBe(lower);
    expect(await estimate(['Brightline'])).toBe(lower);
    expect(await estimate(['Project Falcon', 'INVOIC*', 'Kickback', 'Side Letter'])).toBe(630);
  });

  test("every seeded matter's own query still estimates to its seeded count", async () => {
    for (const [id, items] of [['mat_falcon', 630], ['mat_brightwell', 1206], ['mat_q3trading', 9842], ['mat_travel', 311]] as const) {
      const job = (await post(`/matters/${id}/estimates`)).json;
      expect((await runJob(job.id)).at(-1).result.counts.items, id).toBe(items);
    }
  });

  test('with ALL terms, adding one never raises the total', async () => {
    const allOf = async (keywords: string[]) => {
      await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords, keyword_mode: 'all' } });
      return (await runJob((await post(`${M}/estimates`)).json.id)).at(-1).result.counts.items as number;
    };
    // v3's terms, all of them: the fewest-hits term (105) keeps 0.6 of its items per other term, 105 × 0.6³ = 22.7.
    expect(await allOf(FALCON_TERMS)).toBe(23);
    // Each term added on top keeps the same share or less of the fewest-hits term's items, so the total only falls.
    const added = ['brightline', 'offshore', 'rebate', 'consulting fee'];
    const totals = [23];
    for (let n = 1; n <= added.length; n += 1) totals.push(await allOf([...FALCON_TERMS, ...added.slice(0, n)]));
    for (let n = 1; n < totals.length; n += 1) expect(totals[n], `with ${n} added`).toBeLessThanOrEqual(totals[n - 1]!);
    expect(totals.at(-1)).toBeLessThan(23);
    // And taking the added terms away again gives back the same 23, every time.
    expect(await allOf(FALCON_TERMS)).toBe(23);
  });
});

describe('the seeded data in full', () => {
  test('every Falcon query version has its whole KQL and methodology', async () => {
    const versions = (await get(`${M}/versions`)).json.items as Schemas['QueryVersion'][];
    for (const v of versions) expect(v.kql).not.toContain('...');
    const v3 = versions.find((v) => v.version === 3)!;
    expect(v3.kql).toBe(example<Schemas['KqlPreview']>('previewKql', '200').kql);
    expect(v3.methodology).toEqual(example<Schemas['KqlPreview']>('previewKql', '200').methodology);
    expect(versions.find((v) => v.version === 2)!.methodology).toContain('Emails/chats excluded if a participant is at: newsletters.contoso.com.');
  });

  test('no seeded export sits at the same percentage for ever', async () => {
    // Falcon is seeded Previewed, so only its finished v2 export is there; its v3 export is the one the Export screen starts.
    expect(((await get(`${M}/exports`)).json.items as Schemas['Export'][]).map((e) => [e.version, e.status])).toEqual([[2, 'ready']]);
    // The matter seeded as Exporting carries on from 64% on the job clock and finishes like any export.
    const Q3 = '/matters/mat_q3trading';
    expect((await get(`${Q3}/exports`)).json.items[0]).toMatchObject({ status: 'preparing', progress: 0.64 });
    expect((await get(`${Q3}/jobs`, { active: true })).json.items).toMatchObject([{ kind: 'export', status: 'running', progress: 0.64 }]);
    tick(SEEDED_EXPORT_SECONDS * 0.18);
    expect((await get(`${Q3}/exports`)).json.items[0]).toMatchObject({ status: 'preparing', progress: 0.82 });
    tick(SEEDED_EXPORT_SECONDS * 0.18);
    expect((await get(`${Q3}/exports`)).json.items[0]).toMatchObject({ status: 'ready', progress: 1 });
    expect((await get(Q3)).json.stage).toBe('exported');
    expect(((await get(`${Q3}/log`)).json.items as Schemas['LogEntry'][])[0]!.action).toBe('export_finished');
  });

  test('a new matter\'s export check says there is no query yet', async () => {
    const created = (await post('/matters', { matter_number: 'M-77', name: 'New', type: 'dsr' })).json;
    const check = (await post(`/matters/${created.id}/exports/check`)).json as Schemas['ExportCheck'];
    expect(check.checks.map((c) => [c.key, c.status, c.message])).toEqual([
      ['previewed', 'failed', "There's no query to export yet. Estimate and preview one first."],
      ['same_sources', 'skipped', 'Not checked because nothing has been previewed.'],
      ['counts_unchanged', 'skipped', "Not checked because the query wasn't previewed."],
    ]);
  });
});

describe('failing scenarios name the right thing', () => {
  test('a failed job\'s message names its own kind of job', async () => {
    setScenario({ failJobs: ['preview', 'estimate', 'term_report'] });
    const failed = async (path: string) => (await runJob((await post(`${M}/${path}`)).json.id)).at(-1).error.message as string;
    expect(await failed('previews')).toMatch(/^Purview stopped the preview: /);
    expect(await failed('term-reports')).toMatch(/^Purview stopped the term count: /);
    await put(`${M}/draft`, { criteria: { ...(await draft()).criteria, keywords: ['alpha'] } });
    expect(await failed('estimates')).toMatch(/^Purview stopped the estimate: /);
  });

  test('when Purview denies access, exports, previews and term counts fail with that error, like the estimates and hand-offs refused up front', async () => {
    setScenario({ purviewDenied: 'license_missing' });
    expect((await post(`${M}/estimates`)).status).toBe(403);
    expect((await post('/exports/exp_falcon_v2/download')).status).toBe(403);
    expect((await post('/exports/exp_falcon_v2/review-set', { review_set_name: 'x' })).status).toBe(403);

    const started = await post(`${M}/exports`, { options: OPTIONS, confirm_matter_number: 'M-2026-0142' });
    expect(started.status).toBe(202); // the contract starts an export with no 403: the job finds out
    const job = (await runJob(started.json.id)).at(-1);
    expect(job).toMatchObject({ status: 'failed', error: { code: 'license_missing' } });
    expect((await get(`${M}/exports`)).json.items[0]).toMatchObject({ status: 'failed' });
    expect((await get(M)).json.stage).toBe('previewed');

    for (const path of ['previews', 'term-reports']) {
      expect((await runJob((await post(`${M}/${path}`)).json.id)).at(-1)).toMatchObject({ status: 'failed', error: { code: 'license_missing' } });
    }
  });
});
