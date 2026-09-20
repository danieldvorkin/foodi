import { createBrowserRouter, redirect } from 'react-router';
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
import { NotificationsPage, notificationsLoader } from './routes/app/notifications';
import { BlogIndex, blogIndexLoader } from './routes/app/blog';
import { BlogPostPage, blogPostLoader } from './routes/app/blog-post';
import { BlogEditor, blogEditorLoader } from './routes/app/blog-editor';
import { BooksPage, booksLoader } from './routes/app/books';
import { ListPage, listLoader } from './routes/app/list';
import { PlanPage, planLoader } from './routes/app/plan';
import { BookPage, bookLoader } from './routes/app/book';
import { SalesPage, salesLoader } from './routes/app/sales';
import { PayDone, TestCheckout, testCheckoutLoader } from './routes/pay';
import { AdminCommerce, adminCommerceLoader } from './routes/admin/commerce';
import { AdminShop, adminShopLoader } from './routes/admin/shop';
import { ShopPage, shopLoader } from './routes/app/shop';
import { ListingPage, listingLoader } from './routes/app/shop-listing';
import { ListingEditor, listingEditorLoader } from './routes/app/shop-editor';
import { ShopMinePage, shopMineLoader } from './routes/app/shop-mine';
import { AdminLayout, adminLoader } from './routes/admin/layout';
import { AdminOverview, adminOverviewLoader } from './routes/admin/overview';
import { AdminUsers, adminUsersLoader } from './routes/admin/users';
import { AdminUser, adminUserLoader } from './routes/admin/user';
import { AdminRecipes, adminRecipesLoader } from './routes/admin/recipes';
import { AdminCommunity, adminCommunityLoader } from './routes/admin/community';
import { AdminGenerations, adminGenerationsLoader } from './routes/admin/generations';
import { AdminSettings, adminSettingsLoader } from './routes/admin/settings';
import { AdminAudit, adminAuditLoader } from './routes/admin/audit';
import { AdminMedia, adminMediaLoader } from './routes/admin/media';

export const router = createBrowserRouter([
  {
    path: '/',
    element: <Root />,
    errorElement: <ErrorPage />,
    children: [
      { index: true, element: <Landing />, loader: landingLoader },
      { path: 'connect', element: <Connect />, loader: connectLoader },
      { path: 'connect/:vendor', element: <Connect />, loader: connectLoader },
      { path: 'onboarding', element: <Onboarding />, loader: onboardingLoader },
      { path: 'cook/:id', element: <CookPage />, loader: cookLoader },
      { path: 'pay/test/:kind/:id', element: <TestCheckout />, loader: testCheckoutLoader },
      {
        path: 'app',
        id: 'app',
        element: <AppLayout />,
        loader: appLoader,
        children: [
          { index: true, element: <FeedPage />, loader: feedLoader },
          { path: 'feed', loader: () => redirect('/app') },
          { path: 'cook', element: <Home />, loader: homeLoader },
          { path: 'recipes/new', element: <EditorPage />, loader: editorLoader },
          { path: 'recipes/:id', element: <RecipePage />, loader: recipeLoader },
          { path: 'recipes/:id/edit', element: <EditorPage />, loader: editorLoader },
          { path: 'posts/:id', element: <PostPage />, loader: postLoader },
          { path: 'blog', element: <BlogIndex />, loader: blogIndexLoader },
          { path: 'blog/new', element: <BlogEditor />, loader: blogEditorLoader },
          { path: 'blog/:id', element: <BlogPostPage />, loader: blogPostLoader },
          { path: 'blog/:id/edit', element: <BlogEditor />, loader: blogEditorLoader },
          { path: 'books', element: <BooksPage />, loader: booksLoader },
          { path: 'list', element: <ListPage />, loader: listLoader },
          { path: 'plan', element: <PlanPage />, loader: planLoader },
          { path: 'books/:id', element: <BookPage />, loader: bookLoader },
          { path: 'notifications', element: <NotificationsPage />, loader: notificationsLoader },
          { path: 'sales', element: <SalesPage />, loader: salesLoader },
          { path: 'shop', element: <ShopPage />, loader: shopLoader },
          { path: 'shop/new', element: <ListingEditor />, loader: listingEditorLoader },
          { path: 'shop/mine', element: <ShopMinePage />, loader: shopMineLoader },
          { path: 'shop/:id', element: <ListingPage />, loader: listingLoader },
          { path: 'shop/:id/edit', element: <ListingEditor />, loader: listingEditorLoader },
          { path: 'pay/done', element: <PayDone /> },
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
          { path: 'media', element: <AdminMedia />, loader: adminMediaLoader },
          { path: 'commerce', element: <AdminCommerce />, loader: adminCommerceLoader },
          { path: 'shop', element: <AdminShop />, loader: adminShopLoader },
          { path: 'generations', element: <AdminGenerations />, loader: adminGenerationsLoader },
          { path: 'settings', element: <AdminSettings />, loader: adminSettingsLoader },
          { path: 'audit', element: <AdminAudit />, loader: adminAuditLoader },
        ],
      },
    ],
  },
]);
