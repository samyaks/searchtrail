import { MutationCache, QueryCache, QueryClient } from '@tanstack/react-query';
import { ApiRequestError } from '@/api/client';
import { handleSessionExpired } from '@/api/session';

/** Retry once, and only when trying again could help: not for a 4xx, which the server meant. */
export function retryOnce(failureCount: number, error: unknown): boolean {
  if (error instanceof ApiRequestError && error.status >= 400 && error.status < 500) return false;
  return failureCount < 1;
}

export function makeQueryClient() {
  return new QueryClient({
    // An ended session sends the person to sign in, whichever request found out.
    queryCache: new QueryCache({ onError: handleSessionExpired }),
    mutationCache: new MutationCache({ onError: handleSessionExpired }),
    defaultOptions: { queries: { retry: retryOnce, refetchOnWindowFocus: false } },
  });
}
