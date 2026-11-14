// Long actions, as the API runs them: a job is queued, runs while the client polls it, and ends as
// succeeded (with a result) or failed (with an error). Progress moves on every GET /jobs/{id}: after
// `scenario.jobPolls` polls the job finishes. The database changes when it finishes, not when it starts,
// as with the real backend, so a screen has to wait for the job.
import type { Schemas } from '@/api/client';
import { db, type MockJob } from './db';
import { example } from './examples';
import { scenario } from './scenarios';
import { clone, error, iso, nextId } from './util';

type S = Schemas;

type NewJob = Pick<MockJob, 'finish'> & Partial<Pick<MockJob, 'onProgress' | 'onFail'>>;

export function createJob(kind: S['JobKind'], matterId: string, behaviour: NewJob): S['Job'] {
  const stamp = iso();
  const job: S['Job'] = { id: nextId('job'), kind, status: 'queued', progress: 0, matter_id: matterId, created_at: stamp, updated_at: stamp, result: null, error: null };
  db.jobs.set(job.id, { job, polls: 0, ...behaviour });
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

/** One poll of a job: moves it along and returns where it is now. */
export function pollJob(id: string): S['Job'] | undefined {
  const entry = db.jobs.get(id);
  if (!entry) return undefined;
  const { job } = entry;
  if (job.status === 'succeeded' || job.status === 'failed') return clone(job);

  entry.polls += 1;
  job.updated_at = iso();
  const polls = Math.max(1, scenario.jobPolls);
  if (entry.polls < polls) {
    job.status = 'running';
    job.progress = Math.round((entry.polls / polls) * 100) / 100;
    entry.onProgress?.(job.progress);
    return clone(job);
  }
  if (scenario.failJobs.includes(job.kind)) {
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
  return clone(job);
}
