// Smoke test: the app served by the web image shows the real API's data (dry-run compose stack).
import { expect, test } from '@playwright/test';

const MATTER = { matter_number: 'M-2026-0142', name: 'Project Falcon investigation', type: 'investigation' };

test('the Matters list shows a matter created through the API', async ({ page, request }) => {
  // The dry-run database starts empty. A 409 means this stack already has the matter (a rerun
  // without `down -v`); the list should show it either way.
  const created = await request.post('/api/v1/matters', { data: MATTER });
  expect([201, 409], await created.text()).toContain(created.status());

  // A CSP violation or a failed script shows up here, not on the page.
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => message.type() === 'error' && errors.push(message.text()));

  await page.goto('/matters');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toContainText('Contoso Ltd');
  await expect(nav).toContainText('Dry run');

  const row = page.getByRole('table', { name: 'Matters' }).getByRole('row').filter({ hasText: MATTER.matter_number });
  await expect(row.getByRole('link', { name: MATTER.name })).toBeVisible();

  // The production build never registers the MSW mock worker: these were real API answers.
  const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(workers).toBe(0);
  expect(errors).toEqual([]);
});
