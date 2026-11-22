import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { RecipeIngredient, Step } from '@foodi/shared';
import { IngredientList, StepList } from '../RecipeParts';

const line = (item: string, group: string | null = null, quantity: string | null = '1', unit: string | null = 'tbsp'): RecipeIngredient => ({ item, quantity, unit, preparation: null, note: null, group, optional: false, ingredientId: null });

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
  it('shows what a step needs with the amounts, one chip per line', () => {
    // The same item in two groups is two lines with two amounts, so it earns two chips (as in cook
    // mode); pointing at the same line twice does not.
    const ingredients = [line('garlic', 'Kofta', '2', 'cloves'), line('garlic', 'Tzatziki', '1', 'clove'), line('olive oil', null, '3', 'tbsp')];
    const steps: Step[] = [{ title: 'Mix', text: 'Mix the garlic in.', timerSeconds: null, ingredientRefs: [0, 1, 2, 2], temperature: null, tip: null }];
    render(<StepList steps={steps} ingredients={ingredients} />);
    const chips = screen.getAllByText(/garlic|olive oil/, { selector: '.chip' }).map((c) => c.textContent);
    expect(chips).toEqual(['2 cloves garlic', '1 clove garlic', '3 tbsp olive oil']);
  });

  it('ignores a ref that points past the end of the ingredients', () => {
    const steps: Step[] = [{ title: 'Mix', text: 'Mix it.', timerSeconds: null, ingredientRefs: [0, 9], temperature: null, tip: null }];
    render(<StepList steps={steps} ingredients={[line('salt', null, '1', 'tsp')]} />);
    expect(screen.getAllByText(/salt/, { selector: '.chip' }).map((c) => c.textContent)).toEqual(['1 tsp salt']);
  });
});
