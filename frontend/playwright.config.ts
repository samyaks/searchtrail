import { defineConfig, devices } from '@playwright/test';

// End-to-end tests (tests/e2e/) against the running dry-run compose stack, through the web service:
//   docker compose -f deploy/docker-compose.yml up --build -d --wait && npm run test:e2e
// E2E_BASE_URL: the web service (default http://localhost:5173).
// E2E_CHROMIUM_PATH: a Chromium to launch instead of Playwright's own (`npx playwright install chromium`).
const chromiumPath = process.env.E2E_CHROMIUM_PATH;

export default defineConfig({
  testDir: 'tests/e2e',
  outputDir: 'tests/e2e/.results',
  // The tests share one stack and its database, so they run one at a time.
  workers: 1,
  forbidOnly: !!process.env.CI,
  reporter: process.env.CI ? [['list'], ['github']] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
    screenshot: 'off',
    video: 'off',
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'], launchOptions: chromiumPath ? { executablePath: chromiumPath } : {} },
    },
  ],
});
