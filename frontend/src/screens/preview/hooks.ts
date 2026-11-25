// The Preview screen's reads and its one action. Keys sit under ['previews'], so a finished job (src/api/jobs.ts,
// invalidateAfterJob) refreshes the latest preview and its item table by itself.
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api, API_BASE, ApiRequestError, unwrap, type Schemas } from '@/api/client';
import { pollDelay, useTrackedJob } from '@/api/jobs';
import { hasCode } from '@/api/errors';

export type ItemFilter = { location?: string; type?: Schemas['ItemType']; label?: string };

export const PAGE_SIZE = 10;

/** How often the preview job is asked about. Tests make it short; the screen uses the API's default. */
export const jobPolling: { pollMs: (pollCount: number) => number } = { pollMs: pollDelay };

export const previewKeys = {
  latest: (matterId: string) => ['previews', 'latest', matterId] as const,
  items: (previewId: string, filter: ItemFilter, page: number) => ['previews', previewId, 'items', filter, page] as const,
};

/** The matter's latest preview, or null when nothing has been previewed yet (the API's 404). */
export function useLatestPreview(matterId: string) {
  return useQuery({
    queryKey: previewKeys.latest(matterId),
    queryFn: async ({ signal }) => {
      try {
        return unwrap(await api.GET('/matters/{matterId}/previews/latest', { params: { path: { matterId } }, signal }));
      } catch (error) {
        if (hasCode(error, 'not_found')) return null;
        throw error;
      }
    },
  });
}

/** One page of the item table, filtered like the breakdown bars. The last page stays shown while the next loads. */
export function usePreviewItems(previewId: string | undefined, filter: ItemFilter, page: number) {
  return useQuery({
    queryKey: previewKeys.items(previewId ?? '', filter, page),
    enabled: Boolean(previewId),
    placeholderData: keepPreviousData,
    queryFn: async ({ signal }) =>
      unwrap(
        await api.GET('/previews/{previewId}/items', {
          params: { path: { previewId: previewId! }, query: { ...filter, page, page_size: PAGE_SIZE } },
          signal,
        }),
      ),
  });
}

/** Where the whole item list downloads from: a plain link, so the browser saves the file the API names. */
export const csvUrl = (previewId: string) => `${API_BASE}/previews/${encodeURIComponent(previewId)}/items.csv`;

/**
 * The preview job: start one, or follow the one already running (a reload, another tab). Starting while one runs
 * gets the API's 409 with that job's id, and the screen follows it instead of showing an error.
 */
export function usePreviewJob(matterId: string) {
  const job = useTrackedJob(matterId, 'preview', jobPolling);
  const { track } = job;
  const start = useMutation({
    mutationFn: async () => unwrap(await api.POST('/matters/{matterId}/previews', { params: { path: { matterId } } })),
    onSuccess: (started) => track(started.id),
    onError: (error) => {
      const running = runningJobOf(error);
      if (running) track(running);
    },
  });
  // A 409 that names the running job isn't a failure to show: the screen is following that job now.
  const startError = start.error && !runningJobOf(start.error) ? start.error : null;
  return { ...job, start: () => start.mutate(), isStarting: start.isPending, startError };
}

/** The job named by the API's "already running" 409, if that is what this error is. */
function runningJobOf(error: unknown): string | null {
  if (!(error instanceof ApiRequestError) || error.body.code !== 'conflict') return null;
  const id = error.body.details?.job_id;
  return typeof id === 'string' ? id : null;
}
