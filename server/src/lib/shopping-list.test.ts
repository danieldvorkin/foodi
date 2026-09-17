import { describe, expect, it } from 'vitest';
import { categorize, formatQuantity, parseQuantity, parseQuickAdd } from '@foodi/shared';

describe('shopping list parsing', () => {
  it('reads whole numbers, fractions, mixed numbers, glyphs and ranges', () => {
    expect(parseQuantity('2')).toBe(2);
    expect(parseQuantity('1/2')).toBe(0.5);
    expect(parseQuantity('1 1/2')).toBe(1.5);
    expect(parseQuantity('½')).toBe(0.5);
    expect(parseQuantity('2.5')).toBe(2.5);
    expect(parseQuantity('2-3')).toBe(3);
    expect(parseQuantity('a handful')).toBeNull();
    expect(parseQuantity(null)).toBeNull();
  });

  it('splits a quick-add line into quantity, unit and item', () => {
    expect(parseQuickAdd('2 lemons')).toEqual({ quantity: 2, unit: null, text: 'lemons' });
    expect(parseQuickAdd('500 g flour')).toEqual({ quantity: 500, unit: 'g', text: 'flour' });
    expect(parseQuickAdd('1 1/2 cups rice')).toEqual({ quantity: 1.5, unit: 'cup', text: 'rice' });
    expect(parseQuickAdd('2 large yellow onions')).toEqual({ quantity: 2, unit: null, text: 'large yellow onions' });
    expect(parseQuickAdd('olive oil')).toEqual({ quantity: null, unit: null, text: 'olive oil' });
    expect(parseQuickAdd('  3   tbsp.  soy sauce ')).toEqual({ quantity: 3, unit: 'tbsp', text: 'soy sauce' });
  });

  it('files lines under the library aisle when it recognises the ingredient', () => {
    expect(categorize('2 large yellow onions', null)).toMatchObject({ category: 'vegetables', ingredientId: 'onion' });
    expect(categorize('plain flour', null).category).toBe('baking');
    expect(categorize('sugar', null)).toMatchObject({ category: 'baking', ingredientId: 'sugar' });
    expect(categorize('birthday candles', null)).toEqual({ category: 'other', ingredientId: null });
  });

  it('prints quantities the way a list would', () => {
    expect(formatQuantity(0.5)).toBe('½');
    expect(formatQuantity(1.5)).toBe('1½');
    expect(formatQuantity(3)).toBe('3');
    expect(formatQuantity(0.33)).toBe('⅓');
    expect(formatQuantity(2.4)).toBe('2.4');
    expect(formatQuantity(null)).toBe('');
  });
});
