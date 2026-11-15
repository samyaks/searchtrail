// What the web image's reverse proxy promises (deploy/Caddyfile).
import { expect, test } from '@playwright/test';

const BASELINE = { 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY' };

test('client-side routes get the app, checked again on every load', async ({ request }) => {
  const response = await request.get('/matters/m-unknown/scope');
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('text/html');
  expect(await response.text()).toContain('<div id="root">');
  expect(response.headers()['cache-control']).toBe('no-cache');
  expect(response.headers()).toMatchObject(BASELINE);
});

// A missing file is a 404, never the app's HTML (a crawler or a browser asking for /favicon.ico must not
// get a page), and a 404 is never cached. /mockServiceWorker.js is here because the production build
// must not ship the mock worker.
for (const path of ['/favicon.ico', '/robots.txt', '/nope.js', '/mockServiceWorker.js', '/assets/missing.js']) {
  test(`a missing file is a 404 that isn't cached: ${path}`, async ({ request }) => {
    const response = await request.get(path);
    expect(response.status()).toBe(404);
    expect(response.headers()['content-type']).not.toContain('text/html');
    expect(response.headers()['cache-control']).toBe('no-store');
    expect(response.headers()).toMatchObject(BASELINE);
  });
}

test('the built files are cached for a year, and are the right type', async ({ request }) => {
  const html = await (await request.get('/')).text();
  const script = /src="(\/assets\/[^"]+\.js)"/.exec(html)?.[1];
  expect(script, 'the app script in index.html').toBeTruthy();
  const response = await request.get(script!);
  expect(response.status()).toBe(200);
  expect(response.headers()['content-type']).toContain('javascript');
  expect(response.headers()['cache-control']).toBe('public, max-age=31536000, immutable');
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
