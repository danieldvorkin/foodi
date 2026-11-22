import { RecipeContentSchema, RecipeDraftSchema } from '@foodi/shared';
import { describe, expect, it } from 'vitest';
import { recipeJsonSchema } from './prompt.js';

const full = { calories: 520, proteinGrams: 31, carbsGrams: 44, fatGrams: 22, fiberGrams: 7, sugarGrams: 9, sodiumMg: 640 };

describe('recipe nutrition', () => {
  it('asks the model for all seven numbers, with none of them nullable', () => {
    const schema = recipeJsonSchema() as { required: string[]; properties: Record<string, { type?: unknown; required?: string[] }> };
    expect(schema.required).toContain('nutritionPerServing');
    const n = schema.properties['nutritionPerServing']!;
    // `['object', 'null']` is how a nullable field renders: the model may then skip it.
    expect(n.type).toBe('object');
    expect(n.required).toEqual(expect.arrayContaining(['calories', 'proteinGrams', 'carbsGrams', 'fatGrams', 'fiberGrams', 'sugarGrams', 'sodiumMg']));
  });

  it('refuses a draft missing any of them', () => {
    const field = RecipeDraftSchema.shape.nutritionPerServing;
    expect(field.safeParse(full).success).toBe(true);
    expect(field.safeParse(null).success).toBe(false);
    expect(field.safeParse({ ...full, sodiumMg: null }).success).toBe(false);
  });

  it('still reads recipes written before nutrition was required', () => {
    // parseContent runs every stored recipe through this; older rows have no nutrition at all.
    const field = RecipeContentSchema.shape.nutritionPerServing;
    expect(field.safeParse(null).success).toBe(true);
    expect(field.safeParse({ ...full, sugarGrams: null, sodiumMg: null }).success).toBe(true);
  });
});
