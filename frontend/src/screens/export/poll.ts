// How often the Export screen asks about its jobs and exports. A module of its own so tests can make it short.
import { pollDelay } from '@/api/jobs';

export const pollMs = (pollCount: number): number => pollDelay(pollCount);
