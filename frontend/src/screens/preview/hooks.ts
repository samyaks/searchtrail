// The Preview screen's reads and its one action. The latest preview's key sits under ['previews', 'latest'], so a
// finished job (src/api/jobs.ts, invalidateAfterJob) refreshes it by itself; a new preview has a new id, so its item
// table is a new query. An old preview's items are never asked for again.
import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query';
import { api, ApiRequestError, unwrap, type Schemas } from '@/api/client';
import { pollDelay, useTrackedJob } from '@/api/jobs';
import { hasCode } from '@/api/errors';

export type ItemFilter = { location?: string; type?: Schemas['ItemType']; label?: string };

export const PAGE_SIZE = 10;

/**
 * How often the preview job is asked about; the screen uses the API's default. A test seam: tests make it short.
 * Don't mutate it in app code.
 */
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

/** The file name a Content-Disposition header gives (`attachment; filename="M-2026-0142 preview v3.csv"`), if any. */
export function fileNameOf(disposition: string | null, fallback = 'preview.csv'): string {
  if (!disposition) return fallback;
  const encoded = /filename\*\s*=\s*(?:UTF-8'')?([^;]+)/i.exec(disposition);
  if (encoded) {
    try {
      return decodeURIComponent(encoded[1]!.trim().replace(/^"|"$/g, '')) || fallback;
    } catch {
      // a malformed encoding: fall back to the plain filename
    }
  }
  const plain = /filename\s*=\s*("([^"]*)"|[^;]+)/i.exec(disposition);
  const name = (plain?.[2] ?? plain?.[1] ?? '').trim();
  return name || fallback;
}

/**
 * The whole item list as a file. Fetched through the API client (so the session, errors and the mocks work as for
 * any other request), then saved with a temporary link to the downloaded blob, under the name the API gives it.
 */
export function useDownloadCsv(previewId: string) {
  return useMutation({
    mutationFn: async () => {
      const result = await api.GET('/previews/{previewId}/items.csv', { params: { path: { previewId } }, parseAs: 'blob' });
      const blob = unwrap(result);
      saveFile(blob, fileNameOf(result.response.headers.get('Content-Disposition')));
    },
  });
}

function saveFile(blob: Blob, fileName: string) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.style.display = 'none';
  document.body.append(link);
  link.click();
  link.remove();
  // Some browsers start reading the file only after the click returns: let go of it a moment later.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

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
