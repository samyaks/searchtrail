// The Export screen's reads and actions. Keys start with 'exports' (or 'matters'), so a finished job, which
// invalidates both (src/api/jobs.ts), re-runs the checks and refreshes the history.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from '@/api/client';
import { useTrackedJob } from '@/api/jobs';
import { pollMs } from './poll';

export const exportKeys = {
  check: (matterId: string) => ['exports', 'check', matterId] as const,
  list: (matterId: string) => ['exports', 'list', matterId] as const,
  detail: (exportId: string) => ['exports', 'detail', exportId] as const,
  versions: (matterId: string) => ['matters', matterId, 'versions'] as const,
};

/** The export checks (previewed, same sources, counts unchanged), as a real export would run them now. */
export function useExportCheck(matterId: string) {
  return useQuery({
    queryKey: exportKeys.check(matterId),
    queryFn: async ({ signal }) => unwrap(await api.POST('/matters/{matterId}/exports/check', { params: { path: { matterId } }, signal })),
    staleTime: 0,
  });
}

/** The matter's exports, newest first. `live`: something is running, so ask again until it ends. */
export function useExports(matterId: string, live: boolean) {
  return useQuery({
    queryKey: exportKeys.list(matterId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/matters/{matterId}/exports', { params: { path: { matterId } }, signal })),
    refetchInterval: live ? (q) => pollMs(q.state.dataUpdateCount) : false,
  });
}

/** One export, with its files and hand-offs. */
export function useExport(exportId: string | null, live: boolean) {
  return useQuery({
    queryKey: exportKeys.detail(exportId ?? ''),
    enabled: Boolean(exportId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/exports/{exportId}', { params: { path: { exportId: exportId! } }, signal })),
    refetchInterval: live ? (q) => pollMs(q.state.dataUpdateCount) : false,
  });
}

/** The query versions, for the methodology of the version being exported. */
export function useVersions(matterId: string) {
  return useQuery({
    queryKey: exportKeys.versions(matterId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/matters/{matterId}/versions', { params: { path: { matterId } }, signal })),
  });
}

/** The three jobs this screen follows, found again if one is running when the screen opens. */
export function useExportJobs(matterId: string) {
  return {
    exportJob: useTrackedJob(matterId, 'export', { pollMs }),
    downloadJob: useTrackedJob(matterId, 'download', { pollMs }),
    reviewSetJob: useTrackedJob(matterId, 'review_set', { pollMs }),
  };
}

export function useStartExport(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas['ExportStart']) => unwrap(await api.POST('/matters/{matterId}/exports', { params: { path: { matterId } }, body })),
    // The new export is in the history at once, as Preparing.
    onSettled: () => void client.invalidateQueries({ queryKey: exportKeys.list(matterId) }),
  });
}

export function useStartDownload(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (exportId: string) => unwrap(await api.POST('/exports/{exportId}/download', { params: { path: { exportId } } })),
    onSettled: () => void client.invalidateQueries({ queryKey: exportKeys.list(matterId) }),
  });
}

export function useStartReviewSet(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async ({ exportId, name }: { exportId: string; name: string }) =>
      unwrap(await api.POST('/exports/{exportId}/review-set', { params: { path: { exportId } }, body: { review_set_name: name } })),
    onSettled: () => void client.invalidateQueries({ queryKey: exportKeys.list(matterId) }),
  });
}
