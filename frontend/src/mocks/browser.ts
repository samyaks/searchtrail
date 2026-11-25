import { setupWorker } from 'msw/browser';
import { setSignInHere } from '@/api/session';
import { handlers } from './handlers';
import { resetMocks } from './reset';
import { scenario, setScenario } from './scenarios';

export const worker = setupWorker(...handlers);

// For trying the hard cases by hand: open the browser console and use window.stMocks, for example
//   stMocks.set({ exportCheck: 'countsChanged' })     the export check finds new items
//   stMocks.set({ failJobs: ['preview'], jobSeconds: 30 })   previews fail, and jobs take 30 seconds
//   stMocks.set({ sessionExpired: true })               every request gets 401; Sign in starts a new mock session
//   stMocks.set({ purviewDenied: 'license_missing' })   Purview refuses (403); or 'purview_permission_missing'
//   stMocks.reset()                                     back to the start (also reseeds the data)
// The switches are listed in src/mocks/scenarios.ts.
Object.assign(window, { stMocks: { set: setScenario, reset: resetMocks, get: () => scenario } });

// The mocks can't serve the real sign-in (a full page load to /api/v1/auth/login, then Microsoft), and a page load
// would wipe the mock data. So Sign in starts a new mock session in place instead: the session is live again and
// the app loads again what failed (api/session.ts).
setSignInHere(() => setScenario({ sessionExpired: false }));
