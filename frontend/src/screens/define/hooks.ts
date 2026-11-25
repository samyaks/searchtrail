// The Define screen's reads and writes: the matter (kept fresh while a hold settles), the people search, and the
// changes to details, custodians, holds and sites. Changes to who is searched are shown at once and put back if the
// API refuses them; when the last one settles the matter is read again, so the header's "draft" and "Not previewed
// yet" chips (draft_changed) follow.
import { type QueryClient, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap, type Schemas } from '@/api/client';
import { queryKeys } from '@/api/queries';
import { holdSettling, sameCriteria, type Sources } from './format';

type Matter = Schemas['Matter'];
type Custodian = Schemas['Custodian'];

/** Timings, in one place so tests can shorten them. */
export const timing = {
  /** How often to read the matter again while Purview applies or releases a hold. */
  holdPollMs: 3000,
  /** How long typing has to pause before the directory is searched. */
  searchDebounceMs: 300,
};

const getMatter = async (matterId: string) => unwrap(await api.GET('/matters/{matterId}', { params: { path: { matterId } } }));

/**
 * The matter, under the same key as the header's useMatter, so both show one copy. While a hold is pending or
 * being released it is read again every few seconds, until Purview reports the hold on or off; reopening the
 * screen while a hold settles carries on asking.
 */
export function useDefineMatter(matterId: string) {
  return useQuery({
    queryKey: queryKeys.matter(matterId),
    queryFn: () => getMatter(matterId),
    refetchInterval: (query) => (query.state.data?.custodians.some((c) => holdSettling(c.hold)) ? timing.holdPollMs : false),
  });
}

/** The value, once it has stopped changing for `ms`. */
export function useDebounced<T>(value: T, ms: number): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}

export const MIN_SEARCH = 2; // the contract's minLength for q

/** People in the directory matching `text`, searched once typing pauses and only from two characters. */
export function useDirectorySearch(text: string) {
  const q = useDebounced(text.trim(), timing.searchDebounceMs);
  const query = useQuery({
    queryKey: ['directory', 'users', q] as const,
    queryFn: async () => unwrap(await api.GET('/directory/users', { params: { query: { q } } })),
    enabled: q.length >= MIN_SEARCH,
    staleTime: 30_000,
  });
  return { ...query, q, settled: q === text.trim() };
}

/** Change the cached matter in place (no-op before it has loaded). */
const editMatter = (client: QueryClient, matterId: string, change: (m: Matter) => Matter) =>
  client.setQueryData<Matter>(queryKeys.matter(matterId), (m) => (m ? change(m) : m));

const replaceCustodian = (m: Matter, custodian: Custodian): Matter => ({
  ...m,
  custodians: m.custodians.some((c) => c.user_id === custodian.user_id)
    ? m.custodians.map((c) => (c.user_id === custodian.user_id ? custodian : c))
    : [...m.custodians, custodian],
});

export function useUpdateMatter(matterId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas['MatterUpdate']) => unwrap(await api.PATCH('/matters/{matterId}', { params: { path: { matterId } }, body })),
    onSuccess: async (matter) => {
      // A read of the matter that started before this change would otherwise land after it and undo it.
      await client.cancelQueries({ queryKey: queryKeys.matter(matterId), exact: true });
      client.setQueryData(queryKeys.matter(matterId), matter);
      // The Matters list shows the name too.
      void client.invalidateQueries({ queryKey: ['matters', {}], exact: false, refetchType: 'none' });
    },
  });
}

const sourcesKey = (matterId: string) => ['define', matterId, 'sources'];

/** What a caller wants to hear about each change, even after the part of the screen that asked has gone. */
type SourcesCallbacks<V> = { onSuccess?: (v: V) => void; onError?: (error: unknown, v: V) => void; onMutate?: (v: V) => void };

/**
 * A change to who is searched: shown at once (`apply`), undone if the API refuses it, and followed by one read
 * of the matter when the last such change has settled. Changes to a matter's sources are sent one at a time, in
 * the order they were made, so a later change can't be overtaken by an earlier one.
 */
function useSourcesMutation<V, R>(
  matterId: string,
  request: (v: V) => Promise<R>,
  apply: (m: Matter, v: V) => Matter,
  saved?: (m: Matter, r: R, v: V) => Matter,
  callbacks: SourcesCallbacks<V> = {},
) {
  const client = useQueryClient();
  const mutationKey = sourcesKey(matterId);
  return useMutation({
    mutationKey,
    scope: { id: `define-sources-${matterId}` },
    mutationFn: request,
    onMutate: async (v: V) => {
      callbacks.onMutate?.(v);
      await client.cancelQueries({ queryKey: queryKeys.matter(matterId), exact: true });
      const before = client.getQueryData<Matter>(queryKeys.matter(matterId));
      editMatter(client, matterId, (m) => apply(m, v));
      return { before };
    },
    onSuccess: (r, v) => {
      // While later changes wait, what is shown already includes them; the API's copy of this one could undo them.
      if (saved && client.isMutating({ mutationKey }) <= 1) editMatter(client, matterId, (m) => saved(m, r, v));
      callbacks.onSuccess?.(v);
    },
    onError: (error, v, context) => {
      // Put the matter back as it was, unless later changes are still waiting their turn: they were shown on top
      // of this one, and the read of the matter once they have settled shows what the API kept.
      if (context?.before && client.isMutating({ mutationKey }) <= 1) client.setQueryData(queryKeys.matter(matterId), context.before);
      callbacks.onError?.(error, v);
    },
    onSettled: () => {
      // This mutation still counts as running here, so 1 means it is the last.
      if (client.isMutating({ mutationKey }) <= 1) void client.invalidateQueries({ queryKey: ['matters'] });
    },
  });
}

export type CustodianChange = { custodian: Custodian; sources: Sources };

/** Add a person as a custodian, or change which of their sources are searched. */
export function useUpsertCustodian(matterId: string) {
  return useSourcesMutation(
    matterId,
    async ({ custodian, sources }: CustodianChange) =>
      unwrap(await api.PUT('/matters/{matterId}/custodians/{userId}', { params: { path: { matterId, userId: custodian.user_id } }, body: sources })),
    (m, { custodian, sources }) => replaceCustodian(m, { ...custodian, ...sources }),
    (m, saved) => replaceCustodian(m, saved),
  );
}

/**
 * Remove a custodian. Their row goes at once, so what the caller is told (a refusal, say) goes to `callbacks`,
 * which are kept with the change itself rather than with the row.
 */
export function useRemoveCustodian(matterId: string, callbacks?: SourcesCallbacks<string>) {
  return useSourcesMutation(
    matterId,
    async (userId: string) => unwrap(await api.DELETE('/matters/{matterId}/custodians/{userId}', { params: { path: { matterId, userId } } })),
    (m, userId) => ({ ...m, custodians: m.custodians.filter((c) => c.user_id !== userId) }),
    undefined,
    callbacks,
  );
}

export function useAddSite(matterId: string) {
  return useSourcesMutation(
    matterId,
    async (url: string) => unwrap(await api.POST('/matters/{matterId}/sites', { params: { path: { matterId } }, body: { url } })),
    (m, url) => ({ ...m, sites: [...m.sites, { id: `adding:${url}`, url }] }),
    (m, site, url) => ({ ...m, sites: m.sites.map((s) => (s.id === `adding:${url}` ? site : s)) }),
  );
}

export function useRemoveSite(matterId: string) {
  return useSourcesMutation(
    matterId,
    async (siteId: string) => unwrap(await api.DELETE('/matters/{matterId}/sites/{siteId}', { params: { path: { matterId, siteId } } })),
    (m, siteId) => ({ ...m, sites: m.sites.filter((s) => s.id !== siteId) }),
  );
}

/**
 * Place or release a hold. Not shown ahead of the answer: the API says `pending` or `releasing`, and the matter is
 * then read every few seconds (useDefineMatter) until Purview has finished.
 */
export function useSetHold(matterId: string, userId: string) {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (onHold: boolean) =>
      unwrap(await api.PUT('/matters/{matterId}/custodians/{userId}/hold', { params: { path: { matterId, userId } }, body: { on_hold: onHold } })),
    onSuccess: async (custodian) => {
      // A read of the matter that started before the answer would otherwise put the old hold back.
      await client.cancelQueries({ queryKey: queryKeys.matter(matterId), exact: true });
      editMatter(client, matterId, (m) => replaceCustodian(m, custodian));
    },
  });
}

/** `null` while it isn't known yet (or nothing has changed). */
export type ChangeKind = 'sources' | 'search' | null;

/**
 * Whether a changed draft differs from the current version in who is searched only (`sources`), or in its criteria
 * too (`search`). The contract's draft_changed covers both, so the draft's criteria are compared with the version's.
 */
export function useChangeKind(matter: Matter | undefined): ChangeKind {
  const matterId = matter?.id ?? '';
  const enabled = !!matter?.draft_changed && matter.current_version !== null;
  const draft = useQuery({
    queryKey: [...queryKeys.matter(matterId), 'draft'],
    queryFn: async () => unwrap(await api.GET('/matters/{matterId}/draft', { params: { path: { matterId } } })),
    enabled,
  });
  const versions = useQuery({
    queryKey: [...queryKeys.matter(matterId), 'versions'],
    queryFn: async () => unwrap(await api.GET('/matters/{matterId}/versions', { params: { path: { matterId } } })),
    enabled,
  });
  if (!enabled) return null;
  // Until both have been read, say neither, so the wording doesn't change under the reader; if either can't be
  // read, say the search changed, which is never wrong.
  if (draft.isError || versions.isError) return 'search';
  if (!draft.data || !versions.data) return null;
  const current = versions.data.items.find((v) => v.version === matter.current_version);
  if (!current) return 'search';
  return sameCriteria(draft.data.criteria, current.criteria) ? 'sources' : 'search';
}
