import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '@/app/App';
import '@/styles/global.css';

// In development the API is mocked with MSW unless VITE_API_MOCKS=off (npm run dev:api).
async function startMocks() {
  if (import.meta.env.DEV && import.meta.env.VITE_API_MOCKS !== 'off') {
    const { worker } = await import('@/mocks/browser');
    await worker.start({ onUnhandledRequest: 'bypass', quiet: true });
  }
}

function render() {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
}

// Render even if the mocks fail to start, so a broken service worker gives a visible app and a
// console error instead of a blank page.
startMocks()
  .catch((error: unknown) => console.error('API mocks failed to start; requests go to the real API.', error))
  .finally(render);
