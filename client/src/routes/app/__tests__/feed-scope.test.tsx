import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { createMemoryRouter, Outlet, RouterProvider } from 'react-router';
import { render } from '@testing-library/react';
import type { Me } from '@foodi/shared';
import { ToastProvider } from '../../../components/Toast';
import { FeedPage, feedLoader } from '../feed';
import { stubApi } from '../../../test/helpers';

const me: Me = {
  id: 'u1',
  role: 'consumer',
  displayName: 'Ada',
  email: 'ada@example.com',
  avatar: '👩‍🍳',
  handle: 'ada',
  signInMethods: ['password'],
  vendor: null,
  credentialKind: null,
  credentialHint: null,
  credentialUpdatedAt: null,
  hasProfile: true,
  permissions: [],
  createdAt: new Date().toISOString(),
};

describe('Feed scope', () => {
  it('switching to Following puts ?scope=following in the URL and re-runs the loader with it', async () => {
    const calls = stubApi({
      'GET /api/social/feed': { items: [], nextBefore: null },
      'GET /api/recipes': { recipes: [] },
      'GET /api/social/suggestions': { people: [] },
      'GET /api/commerce/featured': { promotions: [] },
    });
    // Same shape as the real router: an 'app' parent whose loader supplies `me`, and the feed as its index child.
    const r2 = createMemoryRouter(
      [
        {
          id: 'app',
          path: '/app',
          loader: () => ({ me }),
          element: (
            <ToastProvider>
              <Outlet />
            </ToastProvider>
          ),
          children: [{ index: true, element: <FeedPage />, loader: feedLoader }],
        },
      ],
      { initialEntries: ['/app'] },
    );
    render(<RouterProvider router={r2} />);
    expect(await screen.findByRole('tab', { name: /Everyone/ })).toHaveAttribute('aria-selected', 'true');
    const user = userEvent.setup();
    await user.click(screen.getByRole('tab', { name: /Following/ }));
    await waitFor(() => expect(r2.state.location.search).toBe('?scope=following'));
    await waitFor(() => expect(calls.some((c) => c.url.includes('/api/social/feed?scope=following'))).toBe(true));
  });
});
