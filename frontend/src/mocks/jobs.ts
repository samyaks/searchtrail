// Long actions, as the API runs them: a job is queued, runs for a while and ends as succeeded (with a result) or
// failed (with an error). How far along it is depends on the mock clock, not on how often anything asks: a
// job takes `scenario.jobSeconds` from when it starts (9 by default, so a screen polling every 3 seconds sees
// three steps). Every request settles the jobs first (route.ts), so a job that is due has finished, and changed
// the data, whichever endpoint is read next, as with the real backend, where the worker runs on its own. In
// tests, advance the clock with setNow() to move jobs along.
import type { Schemas } from '@/api/client';
import { db, type MockJob } from './db';
import { jobDeniedByPurview } from './denied';
import { example } from './examples';
import { exportJobBehaviour } from './exportJob';
import { scenario } from './scenarios';
import { clone, error, iso, nextId, now } from './util';

type S = Schemas;

type NewJob = Pick<MockJob, 'finish'> & Partial<Pick<MockJob, 'onProgress' | 'onFail' | 'exportId'>>;

export function createJob(kind: S['JobKind'], matterId: string, behaviour: NewJob): S['Job'] {
  const stamp = iso();
  const job: S['Job'] = { id: nextId('job'), kind, status: 'queued', progress: 0, matter_id: matterId, created_at: stamp, updated_at: stamp, result: null, error: null };
  db.jobs.set(job.id, { job, startedAt: now().getTime(), durationMs: Math.max(0, scenario.jobSeconds) * 1000, ...behaviour });
  return clone(job);
}

/** A queued or running job of this kind on this matter, if any. */
export function activeJob(matterId: string, kind: S['JobKind']): S['Job'] | undefined {
  return [...db.jobs.values()].map((j) => j.job).find((j) => j.matter_id === matterId && j.kind === kind && (j.status === 'queued' || j.status === 'running'));
}

/** The contract's 409: one of these is already queued or running. */
export function alreadyRunning(job: S['Job'], what: string) {
  return error(409, 'conflict', `A ${what} is already running for this matter. Wait for it to finish.`, { job_id: job.id });
}

/** What each kind of job is called in a failure message. */
const JOB_NAMES: Record<S['JobKind'], string> = {
  estimate: 'the estimate',
  preview: 'the preview',
  term_report: 'the term count',
  export: 'the export',
  download: 'the download',
  review_set: 'the review set hand-off',
};

/** The contract's failed-job example (an export's), worded for this kind of job. */
function failureFor(kind: S['JobKind']): S['Error'] {
  const failed = example<S['Job']>('getJob', '200', 'failed').error!;
  return { ...failed, message: failed.message.replace('the export', JOB_NAMES[kind]) };
}

/** Kinds of job that only find out once they run that Purview refuses them (see jobDeniedByPurview). */
const DENIED_WHILE_RUNNING: S['JobKind'][] = ['preview', 'term_report', 'export'];

/** How long a whole export seeded as Preparing takes in Purview, in seconds of the mock clock (at least jobSeconds). */
export const SEEDED_EXPORT_SECONDS = 60;

/**
 * Exports seeded as Preparing in Purview (a matter seeded as Exporting) were started before the mock existed, so no
 * job follows them. Give each one the export's own job, picking up at its seeded progress from the first request,
 * so it finishes on the job clock like any export instead of sitting at the same percentage for ever.
 */
function followSeededExports() {
  for (const m of db.matters) {
    for (const exp of m.exports) {
      if (exp.status !== 'preparing' || [...db.jobs.values()].some((j) => j.exportId === exp.id)) continue;
      const durationMs = Math.max(scenario.jobSeconds, SEEDED_EXPORT_SECONDS) * 1000;
      const job: S['Job'] = {
        id: `job_${exp.id}`, kind: 'export', status: exp.progress > 0 ? 'running' : 'queued', progress: exp.progress, matter_id: m.matter.id,
        created_at: exp.started_at, updated_at: iso(), result: null, error: null,
      };
      db.jobs.set(job.id, { job, exportId: exp.id, startedAt: now().getTime() - exp.progress * durationMs, durationMs, ...exportJobBehaviour(m, exp, 'previewed') });
    }
  }
}

/** Move every job to where the clock says it is: running with some progress, or finished (which changes the data). */
export function settleJobs() {
  followSeededExports();
  const time = now().getTime();
  for (const entry of db.jobs.values()) {
    const { job } = entry;
    if (job.status === 'succeeded' || job.status === 'failed') continue;
    const elapsed = time - entry.startedAt;
    if (elapsed <= 0) continue; // still queued
    job.updated_at = iso();
    const fraction = entry.durationMs === 0 ? 1 : elapsed / entry.durationMs;
    const denied = DENIED_WHILE_RUNNING.includes(job.kind) ? jobDeniedByPurview() : undefined;
    if (denied) {
      // Purview refuses as soon as the job asks it for anything.
      job.status = 'failed';
      job.error = clone(denied);
      entry.onFail?.();
    } else if (fraction < 1) {
      job.status = 'running';
      job.progress = Math.round(fraction * 100) / 100;
      entry.onProgress?.(job.progress);
    } else if (scenario.failJobs.includes(job.kind)) {
      job.status = 'failed';
      job.progress = 0.1;
      job.error = failureFor(job.kind);
      entry.onFail?.();
    } else {
      job.result = entry.finish();
      job.status = 'succeeded';
      job.progress = 1;
      entry.onProgress?.(1);
    }
  }
}

/** Where a job is now. Asking never moves it: only the clock does. */
export function pollJob(id: string): S['Job'] | undefined {
  settleJobs();
  const entry = db.jobs.get(id);
  return entry ? clone(entry.job) : undefined;
}
