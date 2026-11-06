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

startMocks().then(() => {
  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
});
