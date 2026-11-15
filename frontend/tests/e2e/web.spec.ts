// What the web image's reverse proxy promises (deploy/Caddyfile).
import { expect, test } from '@playwright/test';

const BASELINE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

test('client-side routes get the app, with the baseline headers', async ({ request }) => {
  const response = await request.get('/matters/m-unknown/scope');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(await response.text()).toContain('<div id="root">');
  expect(response.headers()).toMatchObject(BASELINE);
});

test("/api is passed through with the API's own headers, each once", async ({ request }) => {
  const response = await request.get('/api/v1/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toMatchObject({ status: 'ok', dry_run: true });
  const names = response.headersArray().map((header) => header.name.toLowerCase());
  for (const name of [...Object.keys(BASELINE), 'content-security-policy', 'cache-control']) {
    expect(names.filter((n) => n === name), name).toHaveLength(1);
  }
  // The API's own policy (backend app/main.py), not the app's.
  expect(response.headers()['content-security-policy']).toBe("default-src 'none'; frame-ancestors 'none'");
});

test('the mock service worker is not shipped', async ({ request }) => {
  const response = await request.get('/mockServiceWorker.js');
  // Served as a client-side route (the app's HTML), not as a script.
  expect(response.headers()['content-type']).toContain('text/html');
});
