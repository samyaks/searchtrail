// The Scope screen's reads and writes: the draft, the live KQL preview, labels, query versions and the estimate.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap } from '@/api/client';
import { pollDelay } from '@/api/jobs';
import { queryKeys } from '@/api/queries';
import { stableKey, type Criteria } from './criteria';

/**
 * How long the screen waits after an edit before asking for the KQL and saving the draft, and how often it asks
 * about a running estimate. Tests make these short.
 */
export const timing = { debounceMs: 300, pollMs: pollDelay };

export const scopeKeys = {
  // Under the matter's key, so a finished job (which invalidates ['matters']) refreshes them too.
  draft: (matterId: string) => [...queryKeys.matter(matterId), 'draft'] as const,
  versions: (matterId: string) => [...queryKeys.matter(matterId), 'versions'] as const,
  labels: ['labels'] as const,
  kql: (criteria: Criteria) => ['kql', stableKey(criteria)] as const,
};

export function useDraft(matterId: string) {
  return useQuery({
    queryKey: scopeKeys.draft(matterId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/matters/{matterId}/draft', { params: { path: { matterId } }, signal })),
  });
}

export function useVersions(matterId: string) {
  return useQuery({
    queryKey: scopeKeys.versions(matterId),
    queryFn: async ({ signal }) => unwrap(await api.GET('/matters/{matterId}/versions', { params: { path: { matterId } }, signal })),
  });
}

/** The tenant's sensitivity labels. They rarely change, so they aren't asked for again for five minutes. */
export function useLabels() {
  return useQuery({
    queryKey: scopeKeys.labels,
    queryFn: async ({ signal }) => unwrap(await api.GET('/labels', { signal })),
    staleTime: 5 * 60_000,
  });
}

/**
 * The KQL, methodology and warnings for some criteria, from the API. The same criteria always give the same
 * answer, so an answer is kept; while new criteria are asked about, the last answer stays on screen.
 */
export function useKqlPreview(criteria: Criteria) {
  return useQuery({
    queryKey: scopeKeys.kql(criteria),
    queryFn: async ({ signal }) => unwrap(await api.POST('/kql/preview', { body: { criteria }, signal })),
    placeholderData: keepPreviousData,
    staleTime: Infinity,
  });
}

/** Save the draft. Saves run one after another (a mutation scope), so an older save can't land after a newer one. */
export function useSaveDraft(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    scope: { id: `draft:${matterId}` },
    mutationFn: async (criteria: Criteria) =>
      unwrap(await api.PUT('/matters/{matterId}/draft', { params: { path: { matterId } }, body: { criteria } })),
    onSuccess: (draft) => {
      client.setQueryData(scopeKeys.draft(matterId), draft);
      // The header's "Query v4 · draft" chip reads the matter's draft_changed.
      void client.invalidateQueries({ queryKey: queryKeys.matter(matterId), exact: true });
    },
  });
}

export function useStartEstimate(matterId: string) {
  return useMutation({
    mutationFn: async () => unwrap(await api.POST('/matters/{matterId}/estimates', { params: { path: { matterId } } })),
  });
}

/** `value`, once it has stopped changing for `ms` milliseconds. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
