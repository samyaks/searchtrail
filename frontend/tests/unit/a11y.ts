import axe from 'axe-core';

/**
 * Fails the test if axe finds an accessibility violation in `container`.
 *
 * jsdom has no layout, so the colour-contrast rule can't run here; tests/unit/tokens.test.ts checks the
 * contrast of every text and background pair the design uses instead. `region` (content outside landmarks)
 * is off because a component is rendered on its own, not in a page.
 */
export async function expectNoA11yViolations(container: Element) {
  const results = await axe.run(container, {
    rules: { 'color-contrast': { enabled: false }, region: { enabled: false } },
  });
  const summary = results.violations.map((v) => `${v.id}: ${v.help} (${v.nodes.map((n) => n.target.join(' ')).join(', ')})`);
  expect(summary).toEqual([]);
}
