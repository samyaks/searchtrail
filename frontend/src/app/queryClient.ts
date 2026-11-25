import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/api/client';
import { noteSessionEnded } from '@/api/session';

/** Retry once, and only when trying again could help: not for a 4xx, which the server meant. */
export function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function makeQueryClient() {
  const client: QueryClient = new QueryClient({
    // An ended session, whichever request found out, is shown once by the Shell with a Sign in button.
    queryCache: new QueryCache({ onError: (error) => noteSessionEnded(client, error) }),
    mutationCache: new MutationCache({ onError: (error) => noteSessionEnded(client, error) }),
    defaultOptions: { queries: { retry: retryOnce, refetchOnWindowFocus: false } },
  });
  return client;
}
