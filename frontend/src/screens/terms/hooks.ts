// The Terms screen's data: the latest term report, and starting a new one (a job, followed with useTrackedJob).
import { useMutation, useQuery } from '@tanstack/react-query';
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
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/matters/{matterId}/term-reports', { params: { path: { matterId } } })),
    onSuccess: (job) => onJob(job.id),
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
