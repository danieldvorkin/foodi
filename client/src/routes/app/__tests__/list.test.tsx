import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { ShoppingItem } from '@foodi/shared';
import { ToastProvider } from '../../../components/Toast';
import { ListPage, groupItems, listLoader } from '../list';
import { stubApi } from '../../../test/helpers';

const item = (id: string, text: string, over: Partial<ShoppingItem> = {}): ShoppingItem => ({ id, text, quantity: null, unit: null, ingredientId: null, category: 'other', checked: false, recipeId: null, recipeTitle: null, planEntryId: null, position: 0, createdAt: new Date().toISOString(), ...over });

function mount() {
  const router = createMemoryRouter([{ path: '/app/list', element: <ToastProvider><ListPage /></ToastProvider>, loader: listLoader }], { initialEntries: ['/app/list'] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Shopping list', () => {
  it('groups by aisle in library order with ticked lines at the bottom of their aisle', () => {
    const groups = groupItems([
      item('a', 'candles', { position: 0 }),
      item('b', 'lemons', { category: 'fruit', position: 1, checked: true }),
      item('c', 'limes', { category: 'fruit', position: 2 }),
      item('d', 'onions', { category: 'vegetables', position: 3 }),
    ]);
    expect(groups.map((g) => g.category)).toEqual(['vegetables', 'fruit', 'other']);
    expect(groups[1]!.items.map((i) => i.text)).toEqual(['limes', 'lemons']);
  });

  it('shows the list by aisle with quantities, ticks a line optimistically, quick-adds, and clears ticked', async () => {
    const lemons = item('l1', 'lemons', { quantity: 4, category: 'fruit', recipeId: 'rcp_1', recipeTitle: 'Lemon soup' });
    const oil = item('o1', 'olive oil', { quantity: 1.5, unit: 'tbsp', category: 'oils & condiments', position: 1 });
    const calls = stubApi({
      'GET /api/list': { items: [lemons, oil], counts: { open: 2, checked: 0 } },
      'PATCH /api/list/items/l1': { item: { ...lemons, checked: true } },
      'POST /api/list/items': { items: [{ ...lemons, checked: true }, oil, item('c1', 'candles', { position: 2 })], added: 1, merged: 0 },
      'POST /api/list/clear': { removed: 1, items: [oil] },
    });
    mount();
    expect(await screen.findByRole('heading', { name: /Fruit/ })).toBeInTheDocument();
    expect(screen.getByText('1½ tbsp')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Lemon soup/ })).toHaveAttribute('href', '/app/recipes/rcp_1');
    expect(screen.getByText('2 to get')).toBeInTheDocument();

    const user = userEvent.setup();
    const lemonRow = screen.getByRole('checkbox', { name: /lemons/ });
    await user.click(lemonRow);
    expect(lemonRow).toBeChecked();
    await waitFor(() => expect(calls.some((c) => c.method === 'PATCH' && c.url.endsWith('/api/list/items/l1'))).toBe(true));
    expect(screen.getByText('1 to get · 1 ticked')).toBeInTheDocument();

    await user.type(screen.getByLabelText('Add to the list'), 'birthday candles{Enter}');
    expect(await screen.findByText('candles')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/list/items'))?.body).toEqual({ text: 'birthday candles' });
    expect(screen.getByRole('heading', { name: /Everything else/ })).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Clear ticked' }));
    await waitFor(() => expect(screen.queryByText('lemons')).toBeNull());
    expect(calls.find((c) => c.url.endsWith('/api/list/clear'))?.body).toEqual({ checkedOnly: true });
    expect(within(screen.getByRole('list')).getAllByRole('listitem')).toHaveLength(1);
  });

  it('starts with an invitation when the list is empty', async () => {
    stubApi({ 'GET /api/list': { items: [], counts: { open: 0, checked: 0 } } });
    mount();
    expect(await screen.findByText(/fills itself from recipes/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Browse recipes' })).toHaveAttribute('href', '/app');
  });
});
