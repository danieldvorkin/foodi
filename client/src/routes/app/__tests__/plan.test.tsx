import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { PlanEntry } from '@foodi/shared';
import { ToastProvider } from '../../../components/Toast';
import { PlanPage, planLoader } from '../plan';
import { stubApi } from '../../../test/helpers';

const entry = (id: string, over: Partial<PlanEntry> = {}): PlanEntry => ({ id, date: '2026-09-15', slot: 'dinner', recipeId: 'rcp_1', title: 'Lemon soup', emoji: '🥣', servings: 4, note: '', done: false, position: 0, recipeAvailable: true, createdAt: new Date().toISOString(), ...over });

function mount(path = '/app/plan?week=2026-09-17') {
  const router = createMemoryRouter([{ path: '/app/plan', element: <ToastProvider><PlanPage /></ToastProvider>, loader: planLoader }], { initialEntries: [path] });
  render(<RouterProvider router={router} />);
  return router;
}

describe('Meal plan', () => {
  it('shows the Monday-based week, adds a recipe to a slot from the picker, and steps between weeks', async () => {
    const calls = stubApi({
      'GET /api/plan': { week: '2026-09-14', entries: [entry('p1')] },
      'GET /api/plan/candidates': { recipes: [{ id: 'rcp_2', title: 'Beef tacos', emoji: '🌮', servings: 2, totalMinutes: 25, mine: true }] },
      'POST /api/plan/entries': { entry: entry('p2', { date: '2026-09-16', slot: 'lunch', recipeId: 'rcp_2', title: 'Beef tacos', emoji: '🌮', servings: 2 }) },
    });
    const router = mount();
    expect(await screen.findByText('14–20 Sep')).toBeInTheDocument();
    expect(calls[0]!.url).toContain('/api/plan?week=2026-09-14');
    const tueDinner = screen.getByRole('region', { name: 'Dinner, Tue 15 Sep' });
    expect(within(tueDinner).getByRole('button', { name: 'Lemon soup' })).toHaveTextContent('×4');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add to Lunch on Wed 16 Sep' }));
    await user.click(await screen.findByRole('button', { name: /Beef tacos/ }));
    const wedLunch = screen.getByRole('region', { name: 'Lunch, Wed 16 Sep' });
    expect(await within(wedLunch).findByRole('button', { name: 'Beef tacos' })).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ date: '2026-09-16', slot: 'lunch', note: '', recipeId: 'rcp_2' });

    await user.click(screen.getByRole('button', { name: 'Next week' }));
    await waitFor(() => expect(router.state.location.search).toBe('?week=2026-09-21'));
  });

  it('opens an entry to mark it cooked, and sends the week to the shopping list', async () => {
    const calls = stubApi({
      'GET /api/plan': { week: '2026-09-14', entries: [entry('p1')] },
      'PATCH /api/plan/entries/p1': { entry: entry('p1', { done: true }) },
      'POST /api/plan/to-list': { added: 3, merged: 1, skipped: [], week: '2026-09-14' },
    });
    mount();
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: 'Lemon soup' }));
    await user.click(screen.getByRole('checkbox', { name: 'Cooked' }));
    await waitFor(() => expect(calls.find((c) => c.method === 'PATCH')?.body).toEqual({ done: true }));
    await user.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.getByRole('button', { name: 'Lemon soup, done' })).toBeInTheDocument();

    // A done meal isn't shopped for, so the button waits for an undone recipe.
    expect(screen.getByRole('button', { name: /Add this week to the list/ })).toBeDisabled();
  });

  it('is an invitation when empty', async () => {
    stubApi({ 'GET /api/plan': { week: '2026-09-14', entries: [] } });
    mount();
    expect(await screen.findByText(/Tap/)).toBeInTheDocument();
    expect(screen.getAllByRole('button', { name: /^Add to/ })).toHaveLength(35);
  });
});
