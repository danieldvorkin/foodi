import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RecipeIngredient, Step } from '@foodi/shared';
import { IngredientList, StepList } from '../RecipeParts';

const line = (item: string, group: string | null = null): RecipeIngredient => ({ item, quantity: '1', unit: 'tbsp', preparation: null, note: null, group, optional: false, ingredientId: null });

describe('IngredientList', () => {
  it('shows named groups first and loose lines last under "Also", with no empty heading', () => {
    render(<IngredientList ingredients={[line('olive oil'), line('lamb', 'Kofta'), line('yogurt', 'Tzatziki'), line('pita')]} />);
    const headings = screen.getAllByRole('heading', { level: 4 }).map((h) => h.textContent);
    expect(headings).toEqual(['Kofta', 'Tzatziki', 'Also']);
    const items = screen.getAllByRole('listitem').map((li) => li.textContent);
    expect(items[0]).toContain('lamb');
    expect(items[items.length - 1]).toContain('pita');
  });

  it('shows no heading at all when nothing is grouped', () => {
    render(<IngredientList ingredients={[line('salt'), line('pepper')]} />);
    expect(screen.queryByRole('heading')).toBeNull();
  });
});

describe('StepList', () => {
  it('de-duplicates "you need" chips that point at the same item', () => {
    const ingredients = [line('garlic', 'Kofta'), line('garlic', 'Tzatziki'), line('olive oil')];
    const steps: Step[] = [{ title: 'Mix', text: 'Mix the garlic in.', timerSeconds: null, ingredientRefs: [0, 1, 2], temperature: null, tip: null }];
    render(<StepList steps={steps} ingredients={ingredients} />);
    const chips = screen.getAllByText(/garlic|olive oil/, { selector: '.chip' }).map((c) => c.textContent);
    expect(chips).toEqual(['garlic', 'olive oil']);
  });
});
