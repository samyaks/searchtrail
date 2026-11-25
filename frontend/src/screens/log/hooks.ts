// The Log screen's reads: query versions, a comparison of two, a page of log entries, and the chain check.
// Every key sits under ['matters', id, ...], so a finished job (which invalidates ['matters']) refreshes them all:
// a new version, new entries, and a fresh check of the chain that now includes them.
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRef } from 'react';
import { api, unwrap } from '@/api/client';
import { isFinished, pollDelay, serverSaidNo } from '@/api/jobs';
import { queryKeys } from '@/api/queries';
import { sessionHasEnded } from '@/api/session';

/** Entries per page. */
export const LOG_PAGE_SIZE = 20;

/**
 * How often jobs are asked about: `pollMs` while one runs, `idleMs` while none does (so a job started on another
 * tab is still noticed). Tests make them short.
 */
export const logPolling = { pollMs: pollDelay, idleMs: 10_000 };

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

const logPage = async (matterId: string, page: number, signal?: AbortSignal) =>
  unwrap(await api.GET('/matters/{matterId}/log', { params: { path: { matterId }, query: { page, page_size: LOG_PAGE_SIZE } }, signal }));

/** One page of the log, newest first. The page shown stays on screen while the next one loads. */
export function useLogPage(matterId: string, page: number) {
  return useQuery({
    queryKey: logKeys.log(matterId, page),
    queryFn: ({ signal }) => logPage(matterId, page, signal),
    placeholderData: keepPreviousData,
  });
}

/**
 * Page 1 of the log, whichever page is shown: its first entry is the chain's head, which the methodology report
 * records. It shares page 1's cache entry, so on page 1 it costs nothing extra.
 */
export function useLogHead(matterId: string) {
  return useQuery({
    queryKey: logKeys.log(matterId, 1),
    queryFn: ({ signal }) => logPage(matterId, 1, signal),
    select: (data) => data.items[0],
  });
}

/**
 * The matter's queued and running jobs. While one runs it is asked about often; while none does, every
 * `logPolling.idleMs`, so a job started elsewhere (another tab, another person) still shows up here.
 */
export function useRunningJobs(matterId: string) {
  // The poll count when the running jobs were first seen: the speed while jobs run counts only the polls since
  // then, so a job that starts after a long idle spell is still asked about often at first.
  const busySince = useRef<number | null>(null);
  const client = useQueryClient();
  return useQuery({
    queryKey: queryKeys.matterJobs(matterId, { active: true }),
    queryFn: async ({ signal }) =>
      unwrap(await api.GET('/matters/{matterId}/jobs', { params: { path: { matterId }, query: { active: true } }, signal })),
    refetchInterval: (q) => {
      // Not while the session has ended: signing in again loads everything again, which starts this again.
      if (serverSaidNo(q.state.error) || sessionHasEnded(client)) return false;
      const active = q.state.data?.items.some((job) => !isFinished(job)) ?? false;
      const polls = q.state.dataUpdateCount + q.state.errorUpdateCount;
      if (!active) {
        busySince.current = null;
        return logPolling.idleMs;
      }
      busySince.current ??= polls;
      return logPolling.pollMs(polls - busySince.current);
    },
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
