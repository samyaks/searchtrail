// Long actions (an estimate, a preview, an export) run as jobs on the server. A screen starts one (a POST that
// answers 202 with the job), then follows it with these hooks:
//
//   const estimate = useTrackedJob(matterId, 'estimate');
//   ...on click: const job = await start(); estimate.track(job.id);
//   ...while it runs: estimate.progress (0 to 1);  when it ends: estimate.result, or estimate.failure.
//
// useTrackedJob also finds a job that is already running when the screen opens (a reload, or another tab
// started it), so the progress comes back instead of the screen offering to start it again.
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { api, unwrap, type ApiError, type Schemas } from './client';
import { queryKeys, type JobQuery } from './queries';

export type JobKind = Schemas['JobKind'];

/** What a finished job of each kind carries in `result` (docs/V1_PLAN.md section 5.1). */
export type JobResults = {
  estimate: Schemas['EstimateResult'];
  preview: Schemas['Preview'];
  term_report: Schemas['TermReport'];
  export: Schemas['Export'];
  download: Schemas['Export'];
  review_set: Schemas['Export'];
};

/** A job whose `result` is typed by its kind. */
export type TypedJob<K extends JobKind = JobKind> = Omit<Schemas['Job'], 'kind' | 'result'> & { kind: K; result: JobResults[K] | null };

export const isFinished = (job: Pick<Schemas['Job'], 'status'>) => job.status === 'succeeded' || job.status === 'failed';

/**
 * How long to wait before asking again, in milliseconds: every 3 seconds at first, then less often, never more
 * than 10 (the contract's range). A Purview operation can take hours, so a long wait should be cheap.
 */
export function pollDelay(pollCount: number): number {
  if (pollCount < 10) return 3_000;
  if (pollCount < 20) return 5_000;
  return 10_000;
}

/** What a finished job may have changed: counts and stage on the matter and the Matters list, the log, previews, exports. */
export function invalidateAfterJob(client: QueryClient) {
  void client.invalidateQueries({ queryKey: ['matters'] });
  void client.invalidateQueries({ queryKey: ['previews'] });
  void client.invalidateQueries({ queryKey: ['exports'] });
}

type Options = {
  /** Milliseconds until the next poll. Tests make this short. */
  pollMs?: (pollCount: number) => number;
};

/**
 * Follow one job until it ends, asking for its state every few seconds. Pass nothing (or null) while there's no
 * job yet. When the job ends, everything it may have changed is refreshed, once.
 */
export function useJob<K extends JobKind = JobKind>(jobId: string | null | undefined, { pollMs = pollDelay }: Options = {}) {
  const client = useQueryClient();
  const query = useQuery({
    queryKey: queryKeys.job(jobId ?? ''),
    enabled: Boolean(jobId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/jobs/{jobId}', { params: { path: { jobId: jobId! } }, signal })),
    refetchInterval: (q) => (q.state.data && isFinished(q.state.data) ? false : pollMs(q.state.dataUpdateCount)),
  });

  const job = query.data as TypedJob<K> | undefined;
  const finished = job !== undefined && isFinished(job);
  const refreshed = useRef<string | null>(null);
  useEffect(() => {
    if (job && finished && refreshed.current !== job.id) {
      refreshed.current = job.id;
      invalidateAfterJob(client);
    }
  }, [client, job, finished]);

  const failure: ApiError | null = job?.status === 'failed' ? (job.error ?? null) : null;
  return {
    job,
    /** 0 to 1. */
    progress: job?.progress ?? 0,
    /** The job is queued or running (or about to be asked about). */
    isRunning: Boolean(jobId) && !finished && !query.isError,
    isSucceeded: job?.status === 'succeeded',
    isFailed: job?.status === 'failed',
    /** Typed by the job's kind; null until it has succeeded. */
    result: job?.status === 'succeeded' ? job.result : null,
    /** Why the job failed (the contract's Error), if it did. */
    failure,
    /** Why asking about the job failed (a request error, not the job's own failure). */
    queryError: query.error,
    refetch: query.refetch,
  };
}

/** A matter's jobs, newest first as the API gives them. `active` limits it to queued or running ones. */
export function useMatterJobs(matterId: string, query: JobQuery = {}, { pollMs = pollDelay }: Options = {}) {
  return useQuery({
    queryKey: queryKeys.matterJobs(matterId, query),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/matters/{matterId}/jobs', { params: { path: { matterId }, query }, signal })),
    // While something is running, keep asking, so a job started in this tab or another is noticed and followed.
    refetchInterval: (q) => (q.state.data?.items.some((j) => !isFinished(j)) ? pollMs(q.state.dataUpdateCount) : false),
  });
}

/**
 * The job of one kind a screen shows: the one it just started (`track`), or else one that is already running
 * on this matter (found when the screen opens). The screen keeps showing that job, and its result, after it
 * ends, until it tracks another or a newer one is found running.
 */
export function useTrackedJob<K extends JobKind>(matterId: string, kind: K, options: Options = {}) {
  const [trackedId, track] = useState<string | null>(null);
  const running = useMatterJobs(matterId, { active: true, kind }, options);
  const foundId = running.data?.items[0]?.id ?? null;
  const followed = useJob<K>(trackedId ?? foundId, options);

  // A running job leaves the "running" list when it ends, so remember it now. And when the one being shown has
  // ended and another is running (started in another tab, say), show that one instead.
  // (Setting state while rendering, guarded like this, is React's way to derive state from a change.)
  const shownEnded = followed.isSucceeded || followed.isFailed;
  if (foundId && foundId !== trackedId && (trackedId === null || shownEnded)) track(foundId);

  return { ...followed, jobId: trackedId ?? foundId, track };
}
