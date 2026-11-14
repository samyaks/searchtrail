import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterAll, afterEach, beforeAll } from 'vitest';
import { resetMocks } from '@/mocks/reset';
import { server } from '@/mocks/server';

// Requests go to the MSW handlers, which serve the contract's examples. Unhandled requests fail the test.
beforeAll(() => server.listen({ onUnhandledRequest: 'error' }));
afterEach(() => {
  cleanup();
  server.resetHandlers();
  resetMocks();
});
afterAll(() => server.close());
