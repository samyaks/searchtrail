/// <reference types="vitest/config" />
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath, URL } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

// MSW's service worker, served by the dev server only, straight from the installed msw so the two
// versions always match. It isn't in public/, so `vite build` never copies it into dist: the
// production build (and the web image) ships no mock code.
function mswWorker(): Plugin {
  return {
    name: 'searchtrail:msw-worker',
    apply: 'serve',
    configureServer(server) {
      const file = createRequire(import.meta.url).resolve('msw/mockServiceWorker.js');
      server.middlewares.use('/mockServiceWorker.js', (_request, response) => {
        response.setHeader('Content-Type', 'text/javascript');
        response.setHeader('Cache-Control', 'no-cache');
        response.end(readFileSync(file));
      });
    },
  };
}

// `npm run dev` serves the app with MSW mocks (no backend needed).
// `npm run dev:api` turns mocks off and proxies /api to the backend on :8000.
export default defineConfig({
  plugins: [react(), mswWorker()],
  resolve: { alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) } },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.SEARCHTRAIL_API_URL ?? 'http://localhost:8000', changeOrigin: false } },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./tests/setup.ts'],
    include: ['tests/unit/**/*.test.{ts,tsx}'],
    css: true,
  },
});
