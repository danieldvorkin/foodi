import { createBrowserRouter } from 'react-router';

export const router = createBrowserRouter([
  { path: '*', element: <main style={{ padding: 32 }}>foodi is warming up…</main> },
]);
