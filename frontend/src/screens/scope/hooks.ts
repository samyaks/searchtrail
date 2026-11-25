// The Scope screen's reads and writes: the draft, the live KQL preview, labels, query versions and the estimate.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap, type Schemas } from '@/api/client';
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
  /** The draft saves of a matter (a mutation key). */
  saves: (matterId: string) => ['scope', 'saveDraft', matterId] as const,
};

/**
 * Saves and estimates of one matter share this mutation scope, so they run one after another in the order they
 * were asked for: an older save can't land after a newer one, and an estimate waits for the saves before it.
 */
const draftScope = (matterId: string) => ({ id: `draft:${matterId}` });

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
 * answer, so an answer is kept. While new criteria are asked about, the last answer stays on screen, whether it
 * was a query or an error (criteria_invalid), so nothing flickers or goes blank between answers.
 */
export function useKqlPreview(criteria: Criteria) {
  const query = useQuery({
    queryKey: scopeKeys.kql(criteria),
    queryFn: async ({ signal }) => unwrap(await api.POST('/kql/preview', { body: { criteria }, signal })),
    staleTime: Infinity,
  });
  type Answer = { data: Schemas['KqlPreview'] | undefined; error: Error | null };
  const answered: Answer | null = query.isSuccess ? { data: query.data, error: null } : query.isError ? { data: undefined, error: query.error } : null;
  const [last, setLast] = useState<Answer>({ data: undefined, error: null });
  // (Setting state while rendering, guarded like this, is React's way to derive state from a change.)
  if (answered && (answered.data !== last.data || answered.error !== last.error)) setLast(answered);
  const shown = answered ?? last;
  return { data: shown.data, error: shown.error, isError: shown.error !== null, refetch: query.refetch };
}

/** Save the draft. Saves run one after another (the draft's mutation scope), so an older save can't land after a newer one. */
export function useSaveDraft(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    scope: draftScope(matterId),
    mutationKey: scopeKeys.saves(matterId),
    mutationFn: async (criteria: Criteria) =>
      unwrap(await api.PUT('/matters/{matterId}/draft', { params: { path: { matterId } }, body: { criteria } })),
    // A draft GET still on its way may answer from before this save; don't let it land over the saved draft.
    onMutate: () => client.cancelQueries({ queryKey: scopeKeys.draft(matterId) }),
    onSuccess: (draft) => {
      client.setQueryData(scopeKeys.draft(matterId), draft);
      // The header's "Query v4 · draft" chip reads the matter's draft_changed.
      void client.invalidateQueries({ queryKey: queryKeys.matter(matterId), exact: true });
    },
    onSettled: () => {
      // Once the last save has settled (this one is still counted), read the draft again: a GET that started
      // while a save was on its way may have answered with the draft from before it.
      if (client.isMutating({ mutationKey: scopeKeys.saves(matterId) }) <= 1) {
        void client.invalidateQueries({ queryKey: scopeKeys.draft(matterId), exact: true });
      }
    },
  });
}

/**
 * Start an estimate of the saved draft. It shares the draft's mutation scope, so it waits behind any save asked
 * for before it. (The screen waits for the save of what was on screen first, and doesn't start it if that failed.)
 */
export function useStartEstimate(matterId: string) {
  return useMutation({
    scope: draftScope(matterId),
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
