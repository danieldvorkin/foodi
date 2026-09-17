import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { RecipeBook } from '@foodi/shared';
import { AddToBook } from '../Books';
import { renderWithRouter, stubApi } from '../../test/helpers';

const book = (over: Partial<RecipeBook> & { contains?: boolean } = {}) => ({
  id: 'bok_1',
  name: 'Weeknights',
  emoji: '⚡',
  description: '',
  visibility: 'public' as const,
  owner: { id: 'u1', handle: 'ada', displayName: 'Ada', avatar: '👩‍🍳' },
  recipeCount: 2,
  peek: [],
  isMine: true,
  createdAt: '',
  updatedAt: '',
  forSale: false,
  priceCents: 0,
  salesPitch: '',
  previewCount: 2,
  purchased: false,
  salesCount: 0,
  promoted: false,
  contains: false,
  ...over,
});

describe('AddToBook', () => {
  it('lists books with membership, toggles a recipe in and out, and can create a book inline', async () => {
    const calls = stubApi({
      'GET /api/books': { books: [book(), book({ id: 'bok_2', name: 'Sunday', emoji: '🕰️', contains: true })] },
      'POST /api/books/bok_1/items': { ok: true, recipeCount: 3 },
      'DELETE /api/books/bok_2/items/rcp_9': { ok: true },
      'POST /api/books': { book: book({ id: 'bok_3', name: 'Camping', emoji: '🏕️', recipeCount: 0 }) },
      'POST /api/books/bok_3/items': { ok: true, recipeCount: 1 },
    });
    renderWithRouter(<AddToBook recipeId="rcp_9" open onClose={vi.fn()} />);
    const user = userEvent.setup();
    const weeknights = await screen.findByRole('button', { name: /Weeknights/ });
    expect(weeknights).toHaveAttribute('aria-pressed', 'false');
    expect(screen.getByRole('button', { name: /Sunday/ })).toHaveAttribute('aria-pressed', 'true');

    await user.click(weeknights);
    expect(weeknights).toHaveAttribute('aria-pressed', 'true');
    await user.click(screen.getByRole('button', { name: /Sunday/ }));
    await waitFor(() => expect(calls.some((c) => c.method === 'DELETE')).toBe(true));

    await user.click(screen.getByRole('button', { name: /New book/ }));
    await user.type(screen.getByLabelText('Name'), 'Camping');
    await user.click(screen.getByRole('button', { name: 'Create and add' }));
    expect(await screen.findByRole('button', { name: /Camping/ })).toHaveAttribute('aria-pressed', 'true');
    expect(calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/books'))?.body).toMatchObject({ name: 'Camping', visibility: 'public' });
  });
});
