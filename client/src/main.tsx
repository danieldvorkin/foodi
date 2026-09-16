import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';
import '@fontsource-variable/bricolage-grotesque';
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/community.css';
import './styles/mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
