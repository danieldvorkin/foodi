import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { BrowseRecipe, BrowseRecipeDetail } from '@foodi/shared';
import { ToastProvider } from '../../components/Toast';
import { BrowsePage, browseLoader, BrowseRecipePage, browseRecipeLoader } from '../browse';
import { apiError, stubApi } from '../../test/helpers';

const tile = (id: string, title: string, over: Partial<BrowseRecipe> = {}): BrowseRecipe => ({ id, emoji: '🌮', title, summary: 'Quick and good', mealType: 'dinner', cuisine: 'Mexican', totalMinutes: 25, difficulty: 'easy', servings: 2, dietLabels: ['gluten-free'], tags: [], cover: `/share/recipes/${id}/cover.jpg`, author: { handle: 'foodi', displayName: 'foodi kitchen', avatar: '🥘', isHouse: true }, createdAt: '2026-09-01T00:00:00.000Z', ...over });

function mount(path: string) {
  const router = createMemoryRouter(
    [
      { path: '/browse', element: <ToastProvider><BrowsePage /></ToastProvider>, loader: browseLoader },
      { path: '/browse/:id', element: <ToastProvider><BrowseRecipePage /></ToastProvider>, loader: browseRecipeLoader },
      { path: '/', element: <p>landing</p> },
      { path: '/app/recipes/:id', element: <p>the real recipe</p> },
    ],
    { initialEntries: [path] },
  );
  render(<RouterProvider router={router} />);
  return router;
}

describe('Browse (visitors)', () => {
  it('shows public recipes without a session, filters through the URL, and links tiles to the public page', async () => {
    const calls = stubApi({
      'GET /api/auth/me': () => apiError(401, 'Not signed in.'),
      'GET /share/browse': (_init, url) => ({ recipes: url.includes('diet=vegan') ? [tile('r2', 'Vegan chilli', { dietLabels: ['vegan'] })] : [tile('r1', 'Beef tacos'), tile('r2', 'Vegan chilli', { dietLabels: ['vegan'] })], nextCursor: null }),
    });
    const router = mount('/browse');
    expect(await screen.findByRole('link', { name: /Beef tacos/ })).toHaveAttribute('href', '/browse/r1');
    expect(screen.getByRole('link', { name: 'Create a free account' })).toHaveAttribute('href', expect.stringContaining('returnTo=%2Fbrowse'));
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'vegan' }));
    await waitFor(() => expect(router.state.location.search).toBe('?diet=vegan'));
    await waitFor(() => expect(screen.queryByRole('link', { name: /Beef tacos/ })).toBeNull());
    expect(calls.some((c) => c.url.includes('/share/browse?') && c.url.includes('diet=vegan'))).toBe(true);
    await user.type(screen.getByLabelText('Search recipes'), 'chilli{Enter}');
    await waitFor(() => expect(router.state.location.search).toBe('?diet=vegan&q=chilli'));
  });

  it('teases one recipe: ingredients and step titles, the method behind a free account, and actions ask to join', async () => {
    const detail: BrowseRecipeDetail = { ...tile('r1', 'Beef tacos'), ingredients: [{ item: 'tortillas', quantity: '8', unit: null, preparation: null, note: null, group: null, optional: false, ingredientId: null }], stepTitles: ['Warm the tortillas', 'Fry the beef'], stepCount: 2, activeMinutes: 15, equipment: [], allergens: [], media: [] };
    stubApi({ 'GET /api/auth/me': () => apiError(401, 'Not signed in.'), 'GET /share/browse/r1': { recipe: detail } });
    mount('/browse/r1');
    expect(await screen.findByRole('heading', { name: /Beef tacos/ })).toBeInTheDocument();
    expect(screen.getByText(/8 tortillas/)).toBeInTheDocument();
    expect(screen.getByText('Warm the tortillas')).toBeInTheDocument();
    expect(screen.getByText(/The method is for members/)).toBeInTheDocument();
    await userEvent.setup().click(screen.getByRole('button', { name: /Cook this/ }));
    const sheet = await screen.findByRole('dialog');
    expect(within(sheet).getByText(/cook this step by step/)).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: 'Create a free account' })).toBeInTheDocument();
  });

  it('sends signed-in people to the real recipe page', async () => {
    stubApi({ 'GET /api/auth/me': { id: 'u1', hasProfile: true, vendor: null } });
    const router = mount('/browse/r1');
    await waitFor(() => expect(router.state.location.pathname).toBe('/app/recipes/r1'));
  });
});
