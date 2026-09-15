import { createBrowserRouter } from 'react-router';
import { ErrorPage, Root } from './routes/root';
import { Landing, landingLoader } from './routes/landing';
import { Connect, connectLoader } from './routes/connect';
import { Onboarding, onboardingLoader } from './routes/onboarding';
import { AppLayout, appLoader } from './routes/app/layout';
import { Home, homeLoader } from './routes/app/home';
import { RecipePage, recipeLoader } from './routes/app/recipe';
import { CookPage, cookLoader } from './routes/app/cook';
import { EditorPage, editorLoader } from './routes/app/editor';
import { FeedPage, feedLoader } from './routes/app/feed';
import { PostPage, postLoader } from './routes/app/post';
import { ProfilePage, profileLoader } from './routes/app/profile';
import { SettingsPage, settingsLoader } from './routes/app/settings';
import { AdminLayout, adminLoader } from './routes/admin/layout';
import { AdminOverview, adminOverviewLoader } from './routes/admin/overview';
import { AdminUsers, adminUsersLoader } from './routes/admin/users';
import { AdminUser, adminUserLoader } from './routes/admin/user';
import { AdminRecipes, adminRecipesLoader } from './routes/admin/recipes';
import { AdminCommunity, adminCommunityLoader } from './routes/admin/community';
import { AdminGenerations, adminGenerationsLoader } from './routes/admin/generations';
import { AdminSettings, adminSettingsLoader } from './routes/admin/settings';
import { AdminAudit, adminAuditLoader } from './routes/admin/audit';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Landing />, loader: landingLoader },
      { path: 'connect/:vendor', element: <Connect />, loader: connectLoader },
      { path: 'onboarding', element: <Onboarding />, loader: onboardingLoader },
      { path: 'cook/:id', element: <CookPage />, loader: cookLoader },
      {
        path: 'app',
        id: 'app',
        element: <AppLayout />,
        loader: appLoader,
        children: [
          { index: true, element: <Home />, loader: homeLoader },
          { path: 'recipes/new', element: <EditorPage />, loader: editorLoader },
          { path: 'recipes/:id', element: <RecipePage />, loader: recipeLoader },
          { path: 'recipes/:id/edit', element: <EditorPage />, loader: editorLoader },
          { path: 'feed', element: <FeedPage />, loader: feedLoader },
          { path: 'posts/:id', element: <PostPage />, loader: postLoader },
          { path: 'u/:handle', element: <ProfilePage />, loader: profileLoader },
          { path: 'settings', element: <SettingsPage />, loader: settingsLoader },
        ],
      },
      {
        path: 'admin',
        id: 'admin',
        element: <AdminLayout />,
        loader: adminLoader,
        children: [
          { index: true, element: <AdminOverview />, loader: adminOverviewLoader },
          { path: 'users', element: <AdminUsers />, loader: adminUsersLoader },
          { path: 'users/:id', element: <AdminUser />, loader: adminUserLoader },
          { path: 'recipes', element: <AdminRecipes />, loader: adminRecipesLoader },
          { path: 'community', element: <AdminCommunity />, loader: adminCommunityLoader },
          { path: 'generations', element: <AdminGenerations />, loader: adminGenerationsLoader },
          { path: 'settings', element: <AdminSettings />, loader: adminSettingsLoader },
          { path: 'audit', element: <AdminAudit />, loader: adminAuditLoader },
        ],
      },
    ],
  },
]);
