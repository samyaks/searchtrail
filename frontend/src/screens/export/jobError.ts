import { ApiRequestError, type ApiError } from '@/api/client';

/** A failed job's error as something ErrorNotice can show (it describes thrown request errors). */
export const jobError = (failure: ApiError | null) =>
  new ApiRequestError(0, failure ?? { code: 'internal_error', message: '', details: {} });
