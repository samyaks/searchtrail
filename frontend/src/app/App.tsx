import { createBrowserRouter, RouterProvider } from 'react-router';
import { Providers } from './providers';
import { routes } from './routes';

const router = createBrowserRouter(routes);

export function App() {
  return (
    <Providers>
      <RouterProvider router={router} />
    </Providers>
  );
}
