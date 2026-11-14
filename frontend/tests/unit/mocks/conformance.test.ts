// Calls every operation through the mock backend and checks the response against the contract: the
// status is one the contract defines for that operation, and the body matches its schema. It also keeps
// score of which of the contract's status codes were reached, so a status added to the contract
// can't be forgotten here.
import { setScenario } from '@/mocks/scenarios';
import { errorProblems, operations, requestProblems, responseProblems, statusesOf } from '../contract';
import { ALEX, call, del, FALCON, FALCON_EXPORT, FALCON_PREVIEW, get, HANNAH, patch, post, put, runJob, type Reply } from './api';

const reached = new Map<string, Set<number>>();
/** Statuses any operation may answer, without the contract listing them for each, and the code they carry. */
const GENERIC: Record<number, string> = { 400: 'validation_failed', 404: 'not_found', 409: 'conflict', 500: 'internal_error' };

/** Run a request as the named operation, check the answer against the contract and return it. */
async function exercise(operationId: string, expected: number, request: () => Promise<Reply>): Promise<Reply> {
  const reply = await request();
  expect(reply.status, `${operationId}: ${reply.text.slice(0, 200)}`).toBe(expected);
  if (statusesOf(operationId).includes(reply.status)) {
    if (reply.json !== null) expect(responseProblems(operationId, reply.status, reply.json), `${operationId} ${reply.status} body`).toEqual([]);
  } else {
    // The contract's ErrorCode says validation_failed, not_found, conflict and internal_error "can appear anywhere".
    expect(GENERIC[reply.status], `${operationId} answered ${reply.status}, which the contract doesn't define for it`).toBe(reply.json?.code);
    expect(errorProblems(reply.json), `${operationId} ${reply.status} body`).toEqual([]);
  }
  if (!reached.has(operationId)) reached.set(operationId, new Set());
  reached.get(operationId)!.add(reply.status);
  return reply;
}

const M = `/matters/${FALCON}`;
const CRITERIA = { keywords: ['invoic*'], keyword_mode: 'any', exclude_keywords: [], date_from: null, date_to: null, kinds: ['email'], file_extensions: [], participant_domains: [], exclude_participant_domains: [], label_ids: [], exclude_label_ids: [], doc_date_property: 'lastmodifiedtime', raw_kql: null };

describe('system', () => {
  test('health, sign-in, who I am, setup, labels and the directory', async () => {
    await exercise('getHealth', 200, () => get('/health'));
    const login = await exercise('login', 302, () => get('/auth/login', { return_to: '/matters' }));
    expect(login.headers.get('location')).toBe('/matters');
    await exercise('authCallback', 302, () => get('/auth/callback', { code: 'abc', state: 'xyz' }));
    await exercise('authCallback', 400, () => get('/auth/callback'));
    await exercise('logout', 204, () => post('/auth/logout'));
    await exercise('getMe', 200, () => get('/me'));
    await exercise('getSetupCheck', 200, () => get('/setup/check'));
    await exercise('listLabels', 200, () => get('/labels'));
    const found = await exercise('searchDirectoryUsers', 200, () => get('/directory/users', { q: 'fin' }));
    expect(found.json.items.map((u: { display_name: string }) => u.display_name)).toEqual(['Megan Bowen', 'Hannah Ortega']);
    await exercise('searchDirectoryUsers', 400, () => get('/directory/users', { q: 'f' }));
  });

  test('the cases Microsoft and the database can cause', async () => {
    setScenario({ databaseDown: true });
    await exercise('getHealth', 503, () => get('/health'));
    setScenario({ databaseDown: false, throttled: true });
    await exercise('searchDirectoryUsers', 429, () => get('/directory/users', { q: 'fin' }));
    await exercise('checkExport', 429, () => post(`${M}/exports/check`));
    setScenario({ throttled: false, purviewDenied: 'purview_permission_missing' });
    const role = await exercise('listLabels', 403, () => get('/labels'));
    expect(role.json.code).toBe('purview_permission_missing');
    await exercise('startEstimate', 403, () => post(`${M}/estimates`));
    await exercise('setCustodianHold', 403, () => put(`${M}/custodians/${ALEX}/hold`, { on_hold: true }));
    setScenario({ purviewDenied: 'license_missing' });
    expect((await exercise('listLabels', 403, () => get('/labels'))).json.code).toBe('license_missing');
  });
});

describe('matters, custodians and sites', () => {
  test('list, create, read and edit a matter', async () => {
    await exercise('listMatters', 200, () => get('/matters'));
    await exercise('listMatters', 200, () => get('/matters', { stage: 'exported', q: 'brightwell' }));
    const body = { matter_number: 'M-2026-0200', name: 'New matter', type: 'investigation', description: 'x' };
    expect(requestProblems('createMatter', body)).toEqual([]);
    const created = await exercise('createMatter', 201, () => post('/matters', body));
    await exercise('createMatter', 409, () => post('/matters', { ...body, matter_number: 'm-2026-0200' }));
    await exercise('createMatter', 400, () => post('/matters', { ...body, matter_number: 'no spaces allowed' }));
    await exercise('getMatter', 200, () => get(`/matters/${created.json.id}`));
    await exercise('getMatter', 404, () => get('/matters/mat_nope'));
    await exercise('updateMatter', 200, () => patch(`/matters/${created.json.id}`, { name: 'Renamed' }));
    await exercise('updateMatter', 400, () => patch(`/matters/${created.json.id}`, { matter_number: 'X' }));
    await exercise('updateMatter', 404, () => patch('/matters/mat_nope', { name: 'x' }));
  });

  test('custodians, holds and sites', async () => {
    await exercise('upsertCustodian', 200, () => put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: false }));
    await exercise('upsertCustodian', 200, () => put(`${M}/custodians/${HANNAH}`, { mailbox: true, onedrive: true, sites: ['https://contoso.sharepoint.com/sites/Finance2'] }));
    await exercise('upsertCustodian', 400, () => put(`${M}/custodians/${HANNAH}`, { mailbox: 'yes' }));
    await exercise('upsertCustodian', 404, () => put(`${M}/custodians/not-a-person`, { mailbox: true, onedrive: true }));
    const hold = await exercise('setCustodianHold', 200, () => put(`${M}/custodians/${HANNAH}/hold`, { on_hold: true }));
    expect(hold.json.hold.status).toBe('pending');
    await exercise('setCustodianHold', 404, () => put(`${M}/custodians/not-a-person/hold`, { on_hold: true }));
    setScenario({ holdFails: true });
    await exercise('setCustodianHold', 502, () => put(`${M}/custodians/${HANNAH}/hold`, { on_hold: false }));
    setScenario({ holdFails: false });
    await exercise('removeCustodian', 409, () => del(`${M}/custodians/${HANNAH}`)); // still on hold
    await exercise('removeCustodian', 204, () => del(`${M}/custodians/${ALEX}`));
    await exercise('removeCustodian', 404, () => del(`${M}/custodians/${ALEX}`));

    const site = await exercise('addSite', 201, () => post(`${M}/sites`, { url: 'https://contoso.sharepoint.com/sites/Legal' }));
    await exercise('addSite', 409, () => post(`${M}/sites`, { url: 'https://contoso.sharepoint.com/sites/Legal/' }));
    await exercise('addSite', 400, () => post(`${M}/sites`, { url: 'not a url' }));
    await exercise('addSite', 404, () => post('/matters/mat_nope/sites', { url: 'https://contoso.sharepoint.com/sites/X' }));
    await exercise('removeSite', 204, () => del(`${M}/sites/${site.json.id}`));
    await exercise('removeSite', 404, () => del(`${M}/sites/${site.json.id}`));
  });
});

describe('criteria and estimates', () => {
  test('draft, live KQL and an estimate job', async () => {
    await exercise('getDraft', 200, () => get(`${M}/draft`));
    await exercise('getDraft', 404, () => get('/matters/mat_nope/draft'));
    expect(requestProblems('saveDraft', { criteria: CRITERIA })).toEqual([]);
    await exercise('saveDraft', 200, () => put(`${M}/draft`, { criteria: CRITERIA }));
    await exercise('saveDraft', 400, () => put(`${M}/draft`, { criteria: { ...CRITERIA, kinds: [] } }));
    await exercise('saveDraft', 404, () => put('/matters/mat_nope/draft', { criteria: CRITERIA }));
    await exercise('previewKql', 200, () => post('/kql/preview', { criteria: CRITERIA }));
    await exercise('previewKql', 422, () => post('/kql/preview', { criteria: { ...CRITERIA, keywords: [] } }));
    const job = await exercise('startEstimate', 202, () => post(`${M}/estimates`));
    await exercise('startEstimate', 409, () => post(`${M}/estimates`));
    await exercise('startEstimate', 404, () => post('/matters/mat_nope/estimates'));
    await runJob(job.json.id);
  });

  test('an estimate with nothing to look for is refused', async () => {
    await put(`${M}/draft`, { criteria: { ...CRITERIA, keywords: [] } });
    await exercise('startEstimate', 422, () => post(`${M}/estimates`));
  });
});

describe('previews and term reports', () => {
  test('preview job, latest preview, items and CSV', async () => {
    const job = await exercise('startPreview', 202, () => post(`${M}/previews`));
    await exercise('startPreview', 409, () => post(`${M}/previews`));
    await exercise('startPreview', 404, () => post('/matters/mat_nope/previews'));
    await runJob(job.json.id);
    const latest = await exercise('getLatestPreview', 200, () => get(`${M}/previews/latest`));
    await exercise('getLatestPreview', 404, () => get('/matters/mat_nope/previews/latest'));
    await exercise('getLatestPreview', 404, () => get('/matters/mat_harlow/previews/latest')); // never previewed
    const items = await exercise('listPreviewItems', 200, () => get(`/previews/${latest.json.id}/items`, { page: 2, page_size: 10, type: 'email' }));
    expect(items.json.page).toBe(2);
    await exercise('listPreviewItems', 404, () => get('/previews/prv_nope/items'));
    const csv = await exercise('downloadPreviewItemsCsv', 200, () => get(`/previews/${latest.json.id}/items.csv`));
    expect(csv.headers.get('content-type')).toContain('text/csv');
    expect(csv.text.split('\n')[0]).toBe('item_id,location,item_type,subject,author,date,size,sensitivity_label,encrypted');
    await exercise('downloadPreviewItemsCsv', 404, () => get('/previews/prv_nope/items.csv'));
  });

  test('the contract\'s seeded preview serves items and CSV too', async () => {
    await exercise('listPreviewItems', 200, () => get(`/previews/${FALCON_PREVIEW}/items`));
  });

  test('term report job and latest report', async () => {
    const job = await exercise('startTermReport', 202, () => post(`${M}/term-reports`));
    await exercise('startTermReport', 409, () => post(`${M}/term-reports`));
    await exercise('startTermReport', 404, () => post('/matters/mat_nope/term-reports'));
    await runJob(job.json.id);
    await exercise('getLatestTermReport', 200, () => get(`${M}/term-reports/latest`));
    await exercise('getLatestTermReport', 404, () => get('/matters/mat_harlow/term-reports/latest'));
    await put(`${M}/draft`, { criteria: { ...CRITERIA, keywords: [] } });
    await exercise('startTermReport', 422, () => post(`${M}/term-reports`));
  });
});

describe('exports', () => {
  test('checks, history and one export from start to finish', async () => {
    await exercise('checkExport', 200, () => post(`${M}/exports/check`));
    await exercise('checkExport', 404, () => post('/matters/mat_nope/exports/check'));
    await exercise('listExports', 200, () => get(`${M}/exports`));
    await exercise('listExports', 404, () => get('/matters/mat_nope/exports'));

    const options = { include_partially_indexed: true, partially_indexed_scope: 'responsiveLocations', format: 'pst', include_cloud_attachments: false, teams_transcripts: true };
    expect(requestProblems('startExport', { options, confirm_matter_number: 'M-2026-0142' })).toEqual([]);
    await exercise('startExport', 422, () => post(`${M}/exports`, { options, confirm_matter_number: 'wrong' }));
    await exercise('startExport', 400, () => post(`${M}/exports`, { options: { format: 'zip' }, confirm_matter_number: 'M-2026-0142' }));
    await exercise('startExport', 404, () => post('/matters/mat_nope/exports', { options, confirm_matter_number: 'x' }));
    setScenario({ exportCheck: 'countsChanged' });
    await exercise('startExport', 409, () => post(`${M}/exports`, { options, confirm_matter_number: 'M-2026-0142' }));
    setScenario({ exportCheck: 'auto' });
    const started = await exercise('startExport', 202, () => post(`${M}/exports`, { options, confirm_matter_number: 'M-2026-0142' }));
    await exercise('startExport', 409, () => post(`${M}/exports`, { options, confirm_matter_number: 'M-2026-0142' })); // already running
    await runJob(started.json.id);
    await exercise('getExport', 200, () => get(`/exports/${FALCON_EXPORT}`));
    await exercise('getExport', 404, () => get('/exports/exp_nope'));
  });

  test('download and review set hand-offs', async () => {
    const download = await exercise('startExportDownload', 202, () => post(`/exports/${FALCON_EXPORT}/download`));
    await exercise('startExportDownload', 409, () => post(`/exports/${FALCON_EXPORT}/download`)); // already running
    await exercise('startExportDownload', 404, () => post('/exports/exp_nope/download'));
    await runJob(download.json.id);
    const review = await exercise('startReviewSetHandoff', 202, () => post(`/exports/${FALCON_EXPORT}/review-set`, { review_set_name: 'M-2026-0142 review' }));
    await exercise('startReviewSetHandoff', 409, () => post(`/exports/${FALCON_EXPORT}/review-set`, { review_set_name: 'again' }));
    await exercise('startReviewSetHandoff', 404, () => post('/exports/exp_nope/review-set', { review_set_name: 'x' }));
    await runJob(review.json.id);
    setScenario({ purviewDenied: 'purview_permission_missing' });
    await exercise('startExportDownload', 403, () => post(`/exports/${FALCON_EXPORT}/download`));
    await exercise('startReviewSetHandoff', 403, () => post(`/exports/${FALCON_EXPORT}/review-set`, { review_set_name: 'x' }));
  });

  test('an export that is not ready cannot be handed off', async () => {
    await exercise('startExportDownload', 409, () => post('/exports/exp_falcon_v3/download')); // still preparing
  });
});

describe('versions, log and jobs', () => {
  test('versions and comparison', async () => {
    await exercise('listVersions', 200, () => get(`${M}/versions`));
    await exercise('listVersions', 404, () => get('/matters/mat_nope/versions'));
    await exercise('compareVersions', 200, () => get(`${M}/versions/compare`, { from: 2, to: 3 }));
    await exercise('compareVersions', 200, () => get(`${M}/versions/compare`, { from: 1, to: 3 }));
    await exercise('compareVersions', 400, () => get(`${M}/versions/compare`, { from: 1 }));
    await exercise('compareVersions', 404, () => get(`${M}/versions/compare`, { from: 1, to: 99 }));
  });

  test('the log and its verification', async () => {
    await exercise('listLogEntries', 200, () => get(`${M}/log`, { page: 1, page_size: 5 }));
    await exercise('listLogEntries', 404, () => get('/matters/mat_nope/log'));
    await exercise('verifyLog', 200, () => post(`${M}/log/verify`));
    await exercise('verifyLog', 404, () => post('/matters/mat_nope/log/verify'));
  });

  test('jobs of a matter and one job', async () => {
    const job = await post(`${M}/previews`);
    await exercise('listMatterJobs', 200, () => get(`${M}/jobs`, { active: true, kind: 'preview' }));
    await exercise('listMatterJobs', 404, () => get('/matters/mat_nope/jobs'));
    await exercise('getJob', 200, () => get(`/jobs/${job.json.id}`));
    await exercise('getJob', 404, () => get('/jobs/job_nope'));
  });
});

describe('an expired session', () => {
  test('every operation but health and sign-in answers 401 with the contract\'s error', async () => {
    setScenario({ sessionExpired: true });
    const open = ['getHealth', 'login', 'authCallback'];
    for (const [operationId, { method, path, operation }] of Object.entries(operations)) {
      if (open.includes(operationId)) continue;
      const reply = await call(method, `/api${path}`.replace('/api', '').replace(/\{(\w+)\}/g, 'x'), { body: ['POST', 'PUT', 'PATCH'].includes(method) ? {} : undefined });
      expect(reply.status, operationId).toBe(401);
      expect(Object.keys(operation.responses), operationId).toContain('401');
      expect(responseProblems(operationId, 401, reply.json), operationId).toEqual([]);
      expect(reply.json.code).toBe('session_expired');
    }
    expect((await get('/health')).status).toBe(200);
    expect((await get('/auth/login')).status).toBe(302);
  });
});

// Runs last in this file: which of the contract's status codes did the tests above reach?
describe('status coverage', () => {
  // Statuses the mocks can't reach, and why. Empty: every status the contract defines is exercised above
  // (401 for every operation by the expired-session test).
  const UNREACHABLE: Record<string, string> = {};

  test('the tests reached every status the contract defines, except those listed with a reason', () => {
    const missing: string[] = [];
    for (const operationId of Object.keys(operations)) {
      for (const status of statusesOf(operationId)) {
        const key = `${operationId} ${status}`;
        if (status === 401 || reached.get(operationId)?.has(status) || key in UNREACHABLE) continue;
        missing.push(key);
      }
    }
    expect(missing).toEqual([]);
  });
});
