import { screen } from '@testing-library/react';
import { MATTER_TABS } from '@/app/tabs';
import { renderApp } from './renderApp';

test('/ redirects to the Matters screen', async () => {
  const router = renderApp('/');
  expect(await screen.findByRole('heading', { level: 1, name: 'Matters' })).toBeInTheDocument();
  expect(router.state.location.pathname).toBe('/matters');
});

test.each(MATTER_TABS)('the $label tab has a screen', async ({ path, label }) => {
  renderApp(`/matters/mat_falcon/${path}`);
  expect(await screen.findByRole('heading', { level: 1, name: 'Project Falcon investigation' })).toBeInTheDocument();
  expect(screen.getByRole('heading', { level: 2, name: label })).toBeInTheDocument();
  expect(screen.getByRole('link', { name: label })).toHaveAttribute('aria-current', 'page');
});

test('a matter opens on Scope', async () => {
  const router = renderApp('/matters/mat_falcon');
  await screen.findByRole('heading', { level: 2, name: 'Scope' });
  expect(router.state.location.pathname).toBe('/matters/mat_falcon/scope');
});
