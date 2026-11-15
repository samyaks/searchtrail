// Smoke test: the app served by the web image shows the real API's data (dry-run compose stack).
import { expect, test } from './fixtures';

test('the Matters list shows a matter created through the API', async ({ page, request }) => {
  // A number of its own on every run, so a rerun on the same stack and the other end-to-end tests
  // never collide with it.
  const matter = {
    matter_number: `M-E2E-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: 'Project Falcon investigation',
    type: 'investigation',
  };
  const created = await request.post('/api/v1/matters', { data: matter });
  expect(created.status(), await created.text()).toBe(201);

  await page.goto('/matters');

  const nav = page.getByRole('navigation', { name: 'Main' });
  await expect(nav).toContainText('Contoso Ltd (temporary failure)');
  await expect(nav).toContainText('Dry run');

  const row = page.getByRole('table', { name: 'Matters' }).getByRole('row').filter({ hasText: matter.matter_number });
  await expect(row.getByRole('link', { name: matter.name })).toBeVisible();

  // The production build never registers the MSW mock worker: these were real API answers.
  const workers = await page.evaluate(async () => (await navigator.serviceWorker.getRegistrations()).length);
  expect(workers).toBe(0);
});
