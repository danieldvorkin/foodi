import { emptyProfile, type RecipeContent } from '@foodi/shared';
import { describe, expect, it } from 'vitest';
import { createAnthropicClient } from './anthropic.js';
import { createOpenAiClient } from './openai.js';
import type { GenerateInput } from './types.js';

const request: GenerateInput = {
  profile: emptyProfile,
  prompt: 'Bean salad',
  requestedIngredients: [],
  servings: 2,
  timeBudgetMinutes: 30,
  mealType: null,
  basedOn: null,
  avoidTitles: [],
  seed: null,
};
const credential = { kind: 'api_key' as const, apiKey: 'test-key' };
const nutrition = { calories: 220, proteinGrams: 12, carbsGrams: 31, fatGrams: 6, fiberGrams: 8, sugarGrams: 3, sodiumMg: 320 };
const recipe = {
  emoji: '🥗',
  title: 'Bean salad',
  summary: 'A simple bean salad.',
  cuisine: null,
  mealType: 'lunch',
  servings: 2,
  totalMinutes: 10,
  activeMinutes: 10,
  difficulty: 'easy',
  dietLabels: [],
  tags: [],
  allergens: [],
  equipment: [],
  techniques: [],
  ingredients: [{ item: 'Beans', quantity: '1', unit: 'can', preparation: null, note: null, group: null, optional: false, ingredientId: null }],
  steps: [{ title: 'Drain the beans', text: 'Drain and rinse the beans.', timerSeconds: null, ingredientRefs: [0], temperature: null, tip: null }],
  substitutions: [],
  makeAhead: null,
  storage: null,
  nutritionPerServing: nutrition,
} satisfies RecipeContent;

function options(body: unknown) {
  return { apiBase: 'http://vendor.test', model: 'test-model', fetchImpl: async () => Response.json(body) };
}

describe.each([
  {
    vendor: 'OpenAI',
    client: (content: unknown) => createOpenAiClient(options({ output: [{ type: 'message', content: [{ type: 'output_text', text: JSON.stringify(content) }] }] })),
  },
  {
    vendor: 'Anthropic',
    client: (input: unknown) => createAnthropicClient(options({ content: [{ type: 'tool_use', name: 'save_recipe', input }] })),
  },
])('$vendor recipe generation', ({ client }) => {
  it('returns all seven nutrition values from a complete draft', async () => {
    await expect(client(recipe).generate(request, credential)).resolves.toMatchObject({ content: recipe });
  });

  it.each([
    { field: 'nutritionPerServing', value: null },
    { field: 'fiberGrams', value: { ...nutrition, fiberGrams: null } },
    { field: 'sugarGrams', value: { ...nutrition, sugarGrams: null } },
    { field: 'sodiumMg', value: { ...nutrition, sodiumMg: null } },
  ])('rejects a null $field with bad_output', async ({ field, value }) => {
    await expect(client({ ...recipe, nutritionPerServing: value }).generate(request, credential)).rejects.toMatchObject({
      code: 'bad_output',
      message: expect.stringContaining(field),
    });
  });
});
