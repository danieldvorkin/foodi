import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { RouterProvider } from 'react-router/dom';
import { router } from './router';
import '@fontsource-variable/bricolage-grotesque';
// One place, one order: tokens → base → components → pages → community → mobile overrides last.
// Route files must not import stylesheets themselves, or they'd load after mobile.css and win.
import './styles/tokens.css';
import './styles/base.css';
import './styles/components.css';
import './styles/landing.css';
import './styles/onboarding.css';
import './styles/home.css';
import './styles/cook.css';
import './styles/recipe.css';
import './styles/editor.css';
import './styles/social.css';
import './styles/community.css';
import './styles/admin.css';
import './styles/list.css';
import './styles/plan.css';
import './styles/browse.css';
import './styles/mobile.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
