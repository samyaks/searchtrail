// TanStack Query hooks, one per read endpoint, and the keys that name their data. Screens add their own hooks here
// as they need them (the job hooks are in jobs.ts).
//
// Keys nest: everything about a matter is under ['matters', id, ...], so invalidating ['matters'] refreshes the
// list and every open matter. That is what a finished job does (jobs.ts), because a job changes counts, stage
// and the log.
import { useQuery } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from './client';

export type JobQuery = { active?: boolean; kind?: Schemas['JobKind'] };

export const queryKeys = {
  me: ['me'] as const,
  matters: (stage?: Schemas['MatterStage']) => ['matters', { stage }] as const,
  matter: (id: string) => ['matters', id] as const,
  matterJobs: (id: string, query: JobQuery = {}) => ['matters', id, 'jobs', query] as const,
  job: (id: string) => ['jobs', id] as const,
};

/** The signed-in person, their tenant and Purview roles. Rarely changes, so it isn't refetched for a minute. */
export function useMe() {
  return useQuery({
    queryKey: queryKeys.me,
    queryFn: async () => unwrap(await api.GET('/me')),
    staleTime: 60_000,
  });
}

export function useMatters(stage?: Schemas['MatterStage']) {
  return useQuery({
    queryKey: queryKeys.matters(stage),
    queryFn: async () => unwrap(await api.GET('/matters', { params: { query: { stage } } })),
  });
}

export function useMatter(matterId: string) {
  return useQuery({
    queryKey: queryKeys.matter(matterId),
    queryFn: async () => unwrap(await api.GET('/matters/{matterId}', { params: { path: { matterId } } })),
  });
}
