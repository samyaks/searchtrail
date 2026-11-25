// The Log screen's reads: query versions, a comparison of two, a page of log entries, and the chain check.
// Every key sits under ['matters', id, ...], so a finished job (which invalidates ['matters']) refreshes them all:
// a new version, new entries, and a fresh check of the chain that now includes them.
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { api, unwrap } from '@/api/client';
import { pollDelay } from '@/api/jobs';

/** Entries per page. */
export const LOG_PAGE_SIZE = 20;

/** How often running jobs are asked about. Tests make it short. */
export const logPolling = { pollMs: pollDelay };

export const logKeys = {
  versions: (matterId: string) => ['matters', matterId, 'versions'] as const,
  compare: (matterId: string, from: number, to: number) => ['matters', matterId, 'versions', 'compare', { from, to }] as const,
  log: (matterId: string, page: number) => ['matters', matterId, 'log', { page, pageSize: LOG_PAGE_SIZE }] as const,
  verify: (matterId: string) => ['matters', matterId, 'log-verify'] as const,
};

/** Every query version, oldest first (sorted here too, so the order never depends on the server's). */
export function useVersions(matterId: string) {
  return useQuery({
    queryKey: logKeys.versions(matterId),
    queryFn: async () => unwrap(await api.GET('/matters/{matterId}/versions', { params: { path: { matterId } } })),
    select: (data) => [...data.items].sort((a, b) => a.version - b.version),
  });
}

export function useComparison(matterId: string, pair: { from: number; to: number } | null) {
  return useQuery({
    queryKey: logKeys.compare(matterId, pair?.from ?? 0, pair?.to ?? 0),
    enabled: pair !== null,
    queryFn: async () =>
      unwrap(await api.GET('/matters/{matterId}/versions/compare', { params: { path: { matterId }, query: { from: pair!.from, to: pair!.to } } })),
  });
}

/** One page of the log, newest first. The page shown stays on screen while the next one loads. */
export function useLogPage(matterId: string, page: number) {
  return useQuery({
    queryKey: logKeys.log(matterId, page),
    queryFn: async () =>
      unwrap(await api.GET('/matters/{matterId}/log', { params: { path: { matterId }, query: { page, page_size: LOG_PAGE_SIZE } } })),
    placeholderData: keepPreviousData,
  });
}

/**
 * The hash-chain check. It changes nothing, so it runs as a query: once when the screen opens, again on "Verify
 * again" (refetch), and again whenever something new is logged.
 */
export function useVerification(matterId: string) {
  return useQuery({
    queryKey: logKeys.verify(matterId),
    queryFn: async () => unwrap(await api.POST('/matters/{matterId}/log/verify', { params: { path: { matterId } } })),
  });
}
