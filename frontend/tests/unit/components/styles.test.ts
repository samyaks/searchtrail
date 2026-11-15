import { readdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const dir = resolve(__dirname, '../../../src/components');
const files = readdirSync(dir).filter((f) => f.endsWith('.css'));

test('there are component styles to check', () => {
  expect(files.length).toBeGreaterThanOrEqual(6);
});

test.each(files)('%s uses the design tokens, not raw colours', (file) => {
  const css = readFileSync(resolve(dir, file), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  expect(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], 'hex colours').toEqual([]);
  expect(css.match(/\brgba?\(/g) ?? [], 'rgb() colours (use a token such as --st-shadow-knob)').toEqual([]);
  // Every var(--st-x) must exist in tokens.css.
  const tokens = readFileSync(resolve(dir, '../styles/tokens.css'), 'utf8');
  for (const [, name] of css.matchAll(/var\((--st-[a-z0-9-]+)/g)) {
    expect(tokens, `${name} is used in ${file} but defined nowhere`).toContain(`${name}:`);
  }
});
