// Every spec imports `test` and `expect` from here, not from '@playwright/test', so each test fails on
// any console error or page error. A blocked script (a CSP violation), a missing file or a crash in the
// app shows up there and not on the page. New specs must do the same.
import { expect, test as base } from '@playwright/test';

export const test = base.extend<{ failOnBrowserErrors: void }>({
  failOnBrowserErrors: [
    async ({ page }, use) => {
      const errors: string[] = [];
      page.on('pageerror', (error) => errors.push(`page error: ${error.message}`));
      page.on('console', (message) => message.type() === 'error' && errors.push(`console error: ${message.text()}`));
      await use();
      expect(errors, 'errors in the browser console').toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
