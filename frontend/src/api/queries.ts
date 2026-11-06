// TanStack Query hooks, one per read endpoint. WS-D adds the rest (and the job polling hook).
import { useQuery } from '@tanstack/react-query';
import { api, unwrap, type Schemas } from './client';

export const queryKeys = {
  matters: (stage?: Schemas['MatterStage']) => ['matters', { stage }] as const,
  matter: (id: string) => ['matters', id] as const,
};

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
