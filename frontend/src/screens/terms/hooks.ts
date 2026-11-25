// The Terms screen's data: the latest term report, and starting a new one (a job, followed with useTrackedJob).
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiRequestError, unwrap, type Schemas } from '@/api/client';
import { queryKeys } from '@/api/queries';

export type TermReport = Schemas['TermReport'];

/** Under the matter's key, so a finished job (which refreshes ['matters']) refreshes the report too. */
export const termReportKey = (matterId: string) => [...queryKeys.matter(matterId), 'term-report', 'latest'] as const;

/** The latest term report, or null when the matter has none yet (the API answers 404). */
export function useLatestTermReport(matterId: string) {
  return useQuery({
    queryKey: termReportKey(matterId),
    queryFn: async ({ signal }): Promise<TermReport | null> => {
      try {
        return unwrap(await api.GET('/matters/{matterId}/term-reports/latest', { params: { path: { matterId } }, signal }));
      } catch (error) {
        if (error instanceof ApiRequestError && error.status === 404) return null;
        throw error;
      }
    },
  });
}

/**
 * The matter's draft criteria, which a term report counts (under the same key as Scope's and Define's copy). Read
 * here only to tell, before asking, when the draft can't be counted at all (a From date after the To date).
 */
export function useDraft(matterId: string) {
  return useQuery({
    queryKey: [...queryKeys.matter(matterId), 'draft'],
    queryFn: async ({ signal }) => unwrap(await api.GET('/matters/{matterId}/draft', { params: { path: { matterId } }, signal })),
  });
}

/** Why the draft can't be counted, checked as Scope checks it as it is typed; null when nothing is known to stop it. */
export function draftProblem(criteria: Schemas['Criteria'] | undefined): string | null {
  if (criteria?.date_from && criteria.date_to && criteria.date_from > criteria.date_to) {
    return 'Counting is off: on Scope, the From date is after the To date, so nothing can match. Fix the dates there first.';
  }
  return null;
}

/** The id of the job a 409 says is already running, if it says. */
export function runningJobOf(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.status !== 409) return null;
  const id = error.body.details?.job_id;
  return typeof id === 'string' && id ? id : null;
}

/**
 * Start a term report. `onJob` gets the job to follow: the new one, or the one already running (the API answers
 * 409 with its id when a term report is running for the matter, started in another tab, say).
 */
export function useStartTermReport(matterId: string, onJob: (jobId: string) => void) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/matters/{matterId}/term-reports', { params: { path: { matterId } } })),
    onSuccess: (job) => {
      onJob(job.id);
      // A changed draft became a new query version, the one being counted: the header, the draft and the versions
      // move on now, as they do when an estimate starts, not only when the count is done.
      for (const key of [queryKeys.matter(matterId), [...queryKeys.matter(matterId), 'draft'], [...queryKeys.matter(matterId), 'versions']]) {
        void client.invalidateQueries({ queryKey: key, exact: true });
      }
    },
    onError: (error) => {
      const running = runningJobOf(error);
      if (running) onJob(running);
    },
  });
}

/**
 * Whether `a` is a later report than `b`. The same report fetched twice isn't, even if the server wrote its time
 * differently ("Z" or "+00:00", with or without fractions of a second), so the times are compared as instants.
 */
export function isNewerReport(a: Pick<TermReport, 'id' | 'created_at'>, b: Pick<TermReport, 'id' | 'created_at'>): boolean {
  return a.id !== b.id && Date.parse(a.created_at) > Date.parse(b.created_at);
}
