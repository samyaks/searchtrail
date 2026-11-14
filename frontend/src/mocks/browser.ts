import { setupWorker } from 'msw/browser';
import { handlers } from './handlers';
import { resetMocks } from './reset';
import { scenario, setScenario } from './scenarios';

export const worker = setupWorker(...handlers);

// For trying the hard cases by hand: open the browser console and use window.stMocks, for example
//   stMocks.set({ exportCheck: 'countsChanged' })     the export check finds new items
//   stMocks.set({ failJobs: ['preview'], jobPolls: 5 })   previews fail, and jobs take 5 polls
//   stMocks.set({ sessionExpired: true })               every request gets 401
//   stMocks.set({ purviewDenied: 'license_missing' })   Purview refuses (403); or 'purview_permission_missing'
//   stMocks.reset()                                     back to the start (also reseeds the data)
// The switches are listed in src/mocks/scenarios.ts.
Object.assign(window, { stMocks: { set: setScenario, reset: resetMocks, get: () => scenario } });
