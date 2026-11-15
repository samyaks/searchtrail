// Long actions, as the API runs them: a job is queued, runs for a while and ends as succeeded (with a result) or
// failed (with an error). How far along it is depends on the mock clock, not on how often anything asks: a
// job takes `scenario.jobSeconds` from when it starts (9 by default, so a screen polling every 3 seconds sees
// three steps). Every request settles the jobs first (route.ts), so a job that is due has finished, and changed
// the data, whichever endpoint is read next, as with the real backend, where the worker runs on its own. In
// tests, advance the clock with setNow() to move jobs along.
import type { Schemas } from '@/api/client';
import { db, type MockJob } from './db';
import { example } from './examples';
import { scenario } from './scenarios';
import { clone, error, iso, nextId, now } from './util';

type S = Schemas;

type NewJob = Pick<MockJob, 'finish'> & Partial<Pick<MockJob, 'onProgress' | 'onFail'>>;

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

/** Move every job to where the clock says it is: running with some progress, or finished (which changes the data). */
export function settleJobs() {
  const time = now().getTime();
  for (const entry of db.jobs.values()) {
    const { job } = entry;
    if (job.status === 'succeeded' || job.status === 'failed') continue;
    const elapsed = time - entry.startedAt;
    if (elapsed <= 0) continue; // still queued
    job.updated_at = iso();
    const fraction = entry.durationMs === 0 ? 1 : elapsed / entry.durationMs;
    if (fraction < 1) {
      job.status = 'running';
      job.progress = Math.round(fraction * 100) / 100;
      entry.onProgress?.(job.progress);
    } else if (scenario.failJobs.includes(job.kind)) {
      job.status = 'failed';
      job.progress = 0.1;
      job.error = example<S['Job']>('getJob', '200', 'failed').error;
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
