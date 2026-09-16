import { PREPARATIONS, RecipeContentSchema, type RecipeContent, type RecipeIngredient, type Step } from '@foodi/shared';
import type { SeedRecipe } from './types.js';

const UNITS = new Set([
  'tbsp', 'tsp', 'g', 'kg', 'ml', 'l', 'cup', 'cups', 'clove', 'cloves', 'can', 'cans', 'bunch', 'handful', 'slice', 'slices', 'sprig', 'sprigs', 'pinch',
  'stalk', 'stalks', 'piece', 'pieces', 'oz', 'lb', 'large', 'small', 'medium', 'head', 'heads', 'sheet', 'sheets', 'stick', 'sticks', 'knob', 'squeeze', 'dash', 'splash', 'fillet', 'fillets',
]);
const QTY = /^[\d½¼¾⅓⅔]+(?:[./\-–][\d½¼¾⅓⅔]+)?$/;

export function parseIngredient(raw: string): RecipeIngredient {
  let s = raw.trim();
  let optional = false;
  let group: string | null = null;
  if (s.startsWith('?')) {
    optional = true;
    s = s.slice(1).trim();
  }
  const g = /^([A-Z][A-Za-z &-]{1,30}):\s+(.*)$/.exec(s);
  if (g) {
    group = g[1]!;
    s = g[2]!;
  }
  let preparation: string | null = null;
  let note: string | null = null;
  const comma = s.indexOf(',');
  if (comma > 0) {
    const tail = s.slice(comma + 1).trim();
    s = s.slice(0, comma).trim();
    const firstWord = tail.split(/\s+/)[0]!.toLowerCase();
    if ((PREPARATIONS as readonly string[]).includes(tail.toLowerCase())) preparation = tail.toLowerCase();
    else if ((PREPARATIONS as readonly string[]).includes(firstWord) || /^(finely|roughly|thinly|thickly|coarsely)\b/.test(tail)) preparation = tail;
    else note = tail;
  }
  const tokens = s.split(/\s+/);
  let quantity: string | null = null;
  let unit: string | null = null;
  if (tokens.length > 1 && QTY.test(tokens[0]!)) quantity = tokens.shift()!;
  if (tokens.length > 1 && UNITS.has(tokens[0]!.toLowerCase())) unit = tokens.shift()!.toLowerCase();
  return { item: tokens.join(' '), quantity, unit, preparation, note, group, optional, ingredientId: null };
}

/** Which ingredients does a step mention? Cook mode shows them as "you need" chips. */
function refsFor(text: string, ingredients: RecipeIngredient[]): number[] {
  const t = text.toLowerCase();
  const out: number[] = [];
  ingredients.forEach((ing, i) => {
    const item = ing.item.toLowerCase().replace(/\(.*?\)/g, '').trim();
    if (!item) return;
    const words = item.split(/\s+/);
    const key = words[words.length - 1]!;
    const singular = key.replace(/(es|s)$/, '');
    if (t.includes(item) || (words.length > 1 && key.length >= 5 && t.includes(key)) || (singular.length >= 5 && t.includes(singular))) out.push(i);
  });
  return out.slice(0, 20);
}

export function toContent(seed: SeedRecipe): RecipeContent {
  const ingredients = seed.ing.map(parseIngredient);
  const steps: Step[] = seed.steps.map(([title, text, timer, temperature, tip]) => ({
    title,
    text,
    timerSeconds: timer ?? null,
    ingredientRefs: refsFor(text, ingredients),
    temperature: temperature ?? null,
    tip: tip ?? null,
  }));
  return RecipeContentSchema.parse({
    emoji: seed.emoji,
    title: seed.title,
    summary: seed.summary,
    cuisine: seed.cuisine,
    mealType: seed.meal,
    servings: seed.serves,
    totalMinutes: seed.total,
    activeMinutes: seed.active,
    difficulty: seed.level,
    dietLabels: seed.diet,
    tags: seed.tags,
    allergens: seed.allergens ?? [],
    equipment: seed.equipment,
    techniques: seed.techniques,
    ingredients,
    steps,
    substitutions: (seed.subs ?? []).map(([ingredient, swap, why]) => ({ ingredient, swap, why: why ?? null })),
    makeAhead: seed.makeAhead ?? null,
    storage: seed.storage ?? null,
    nutritionPerServing: { calories: seed.n[0], proteinGrams: seed.n[1], carbsGrams: seed.n[2], fatGrams: seed.n[3], fiberGrams: null, sugarGrams: null, sodiumMg: null },
  });
}
