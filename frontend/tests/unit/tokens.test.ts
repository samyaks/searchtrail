import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { colors } from '@/styles/tokens';

const css = readFileSync(resolve(__dirname, '../../src/styles/tokens.css'), 'utf8');

function cssColor(name: string): string {
  const match = css.match(new RegExp(`--st-${name}:\\s*(#[0-9a-fA-F]{6})`));
  if (!match) throw new Error(`--st-${name} is not a hex colour in tokens.css`);
  return match[1]!.toUpperCase();
}

const toCss: Record<keyof typeof colors, string> = {
  paper: 'paper',
  sheet: 'sheet',
  ink: 'ink',
  muted: 'muted',
  rule: 'rule',
  marginRed: 'margin-red',
  highlighter: 'highlighter',
  okGreen: 'ok-green',
  ruleStrong: 'rule-strong',
  ruleSoft: 'rule-soft',
  highlighterInk: 'highlighter-ink',
  highlighterSoft: 'highlighter-soft',
  redSoft: 'red-soft',
};

test('tokens.ts holds the same colours as tokens.css', () => {
  for (const [key, cssName] of Object.entries(toCss)) {
    expect(colors[key as keyof typeof colors].toUpperCase(), key).toBe(cssColor(cssName));
  }
});

/** WCAG 2.1 contrast ratio of two #RRGGBB colours. */
function contrast(a: string, b: string): number {
  const luminance = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
    const lin = (c: number) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * lin(r!) + 0.7152 * lin(g!) + 0.0722 * lin(bl!);
  };
  const [light, dark] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (light! + 0.05) / (dark! + 0.05);
}

// Every text-on-background pair the design uses (text size is 13px or more, so WCAG AA needs 4.5).
// jsdom can't measure contrast, so this is the contrast check for the component kit.
const PAIRS: [string, keyof typeof colors, keyof typeof colors][] = [
  ['body text on the page', 'ink', 'paper'],
  ['body text on a card', 'ink', 'sheet'],
  ['secondary text on the page', 'muted', 'paper'],
  ['secondary text on a card', 'muted', 'sheet'],
  ['primary button and selected chip', 'sheet', 'ink'],
  ['highlighted chip and "only" segment', 'highlighterInk', 'highlighter'],
  ['selected table row', 'ink', 'highlighterSoft'],
  ['error text on a card', 'marginRed', 'sheet'],
  ['"exclude" segment', 'sheet', 'marginRed'],
  ['passed check text', 'okGreen', 'sheet'],
  ['secondary text on a quiet chip', 'muted', 'ruleSoft'],
];

test.each(PAIRS)('%s has at least 4.5:1 contrast', (_name, fg, bg) => {
  expect(contrast(colors[fg], colors[bg])).toBeGreaterThanOrEqual(4.5);
});

test('the switch and its focus ring are visible against a card (3:1 for non-text, WCAG 1.4.11)', () => {
  expect(contrast(colors.ink, colors.sheet)).toBeGreaterThanOrEqual(3); // an on track, and the focus ring
  // The design's off track (rule-strong on white) is only 1.6:1, so the kit gives it a muted border.
  expect(contrast(colors.ruleStrong, colors.sheet)).toBeLessThan(3);
  expect(contrast(colors.muted, colors.sheet)).toBeGreaterThanOrEqual(3);
});
