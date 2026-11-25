// Data for the Matters list and the New matter form. Kept here, not in src/api/, because only this screen uses them.
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { api, unwrap, type Schemas } from '@/api/client';
import { queryKeys } from '@/api/queries';

export type MatterListQuery = { stage?: Schemas['MatterStage']; q?: string };

/** How often the list is read again while a matter is exporting, so its percentage moves. */
export const EXPORTING_REFRESH_MS = 5_000;

// Under ['matters'], so a finished job (which invalidates ['matters']) refreshes the list and its counts too.
// With no stage and no search this is the same key as useMatters() in src/api/queries.ts.
const listKey = ({ stage, q }: MatterListQuery) => ['matters', { stage, q }] as const;

/**
 * The matters for a stage and a search (`q` matches the matter number and name, on the server). The rows of the
 * previous filter stay on screen while the next one loads, so the table doesn't flicker as the person types.
 */
export function useMatterList(query: MatterListQuery) {
  return useQuery({
    queryKey: listKey(query),
    queryFn: async () => unwrap(await api.GET('/matters', { params: { query } })),
    placeholderData: keepPreviousData,
    refetchInterval: (q) => (q.state.data?.items.some((m) => m.stage === 'exporting') ? EXPORTING_REFRESH_MS : false),
  });
}

/** How many matters are in each stage, and in all, from the unfiltered list (the chips' counts ignore the search, as in the design). */
export function useStageCounts() {
  const all = useMatterList({});
  if (!all.data) return undefined;
  const counts: Record<Schemas['MatterStage'], number> = { scoping: 0, previewed: 0, exporting: 0, exported: 0 };
  for (const m of all.data.items) counts[m.stage] += 1;
  return { all: all.data.items.length, ...counts };
}

/** POST /matters. On success the new matter is put in the cache (its Define tab opens without waiting) and the lists are refreshed. */
export function useCreateMatter() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: async (body: Schemas['MatterCreate']) => unwrap(await api.POST('/matters', { body })),
    onSuccess: (matter) => {
      void client.invalidateQueries({ queryKey: ['matters'] });
      client.setQueryData(queryKeys.matter(matter.id), matter);
    },
  });
}

/** `value`, once it has stopped changing for `ms`. */
export function useDebouncedValue<T>(value: T, ms = 300): T {
  const [settled, setSettled] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setSettled(value), ms);
    return () => clearTimeout(timer);
  }, [value, ms]);
  return settled;
}
