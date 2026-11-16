import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { screen, within } from '@testing-library/react';
import { ERROR_CODES } from '@/api/errors';
import * as kit from '@/components';
import { expectNoA11yViolations } from './a11y';
import { errorCodes } from './contract';
import { renderApp } from './renderApp';

const GALLERY = readFileSync(resolve(__dirname, '../../src/app/gallery/Gallery.tsx'), 'utf8');

test('the gallery is a page of its own, with a heading for each group of components', async () => {
  renderApp('/_gallery');
  expect(await screen.findByRole('heading', { level: 1, name: 'Component gallery' })).toBeInTheDocument();
  expect(screen.getAllByRole('heading', { level: 2 }).map((h) => h.textContent)).toEqual([
    'Buttons',
    'Chips and pills',
    'Segmented controls and switches',
    'Cards and tables',
    'Counts, breakdowns and the month chart',
    'Methodology card',
    'Banners, errors and empty states',
  ]);
  expect(screen.getAllByRole('main')).toHaveLength(1);
});

test('every component in the kit is in the gallery, so a new one cannot be forgotten', () => {
  const components = Object.entries(kit)
    .filter(([name, value]) => /^[A-Z]/.test(name) && (typeof value === 'function' || typeof value === 'object'))
    .map(([name]) => name);
  expect(components.length).toBeGreaterThan(15); // the list came from the kit
  const missing = components.filter((name) => !new RegExp(`<${name}[\\s>/]`).test(GALLERY));
  expect(missing).toEqual([]);
});

test('every error the API can return is shown, and the list is the contract\'s', () => {
  expect([...ERROR_CODES].sort()).toEqual([...errorCodes].sort());
});

test('the gallery shows an error notice for each code, and for a network failure', async () => {
  renderApp('/_gallery');
  const section = (await screen.findByRole('heading', { level: 2, name: 'Banners, errors and empty states' })).closest('section')!;
  const titles = within(section).getAllByRole('heading', { level: 3 }).map((h) => h.textContent);
  expect(titles).toHaveLength(ERROR_CODES.length + 1);
  expect(titles).toContain("Can't reach SearchTrail");
  expect(titles).toContain('Your session has ended');
});

test('the whole gallery has no accessibility violations', async () => {
  renderApp('/_gallery');
  await screen.findByRole('heading', { level: 1, name: 'Component gallery' });
  await expectNoA11yViolations(document.body);
});

test('the gallery is only a route in development: not in a production build', async () => {
  vi.resetModules();
  vi.stubEnv('DEV', false);
  try {
    const { routes } = await import('@/app/routes');
    expect(routes.some((route) => route.path === '_gallery')).toBe(false);
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
  const { routes } = await import('@/app/routes');
  expect(routes.some((route) => route.path === '_gallery')).toBe(true);
});
