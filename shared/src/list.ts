import { z } from 'zod';
import { INGREDIENT_CATEGORIES, matchIngredient, type IngredientCategory } from './ingredients.js';

/** Aisles: the ingredient library's categories plus a bucket for anything it doesn't know. */
export const LIST_CATEGORIES = [...INGREDIENT_CATEGORIES, 'other'] as const;
export type ListCategory = (typeof LIST_CATEGORIES)[number];
export const LIST_CATEGORY_LABEL: Record<ListCategory, string> = {
  vegetables: 'Vegetables',
  fruit: 'Fruit',
  meat: 'Meat',
  poultry: 'Poultry',
  seafood: 'Seafood',
  'eggs & dairy': 'Eggs & dairy',
  'grains & pasta': 'Grains & pasta',
  legumes: 'Legumes',
  'nuts & seeds': 'Nuts & seeds',
  'herbs & spices': 'Herbs & spices',
  'oils & condiments': 'Oils & condiments',
  baking: 'Baking',
  other: 'Everything else',
};

export const ShoppingItemSchema = z.object({
  id: z.string(),
  text: z.string(),
  quantity: z.number().nullable(),
  unit: z.string().nullable(),
  ingredientId: z.string().nullable(),
  category: z.enum(LIST_CATEGORIES),
  checked: z.boolean(),
  /** Where it came from, when it came from a recipe. */
  recipeId: z.string().nullable(),
  recipeTitle: z.string().nullable(),
  planEntryId: z.string().nullable(),
  position: z.number(),
  createdAt: z.string(),
});
export type ShoppingItem = z.infer<typeof ShoppingItemSchema>;

/** Add lines by hand ("2 lemons"), or a recipe's ingredients scaled to a number of servings. */
export const AddListItemsSchema = z.union([
  z.object({ text: z.string().trim().min(1).max(120) }),
  z.object({
    fromRecipe: z.object({
      recipeId: z.string().min(1),
      servings: z.number().int().min(1).max(48).optional(),
      /** Zero-based indexes into the recipe's ingredients; everything when omitted. */
      ingredientIndexes: z.array(z.number().int().min(0)).max(200).optional(),
    }),
  }),
]);
export type AddListItems = z.infer<typeof AddListItemsSchema>;

export const UpdateListItemSchema = z
  .object({
    text: z.string().trim().min(1).max(120).optional(),
    quantity: z.number().min(0).max(100000).nullable().optional(),
    unit: z.string().trim().max(30).nullable().optional(),
    checked: z.boolean().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

export const ClearListSchema = z.object({ checkedOnly: z.boolean().default(true) });

const UNITS = ['g', 'kg', 'mg', 'ml', 'l', 'cl', 'oz', 'lb', 'lbs', 'cup', 'cups', 'tbsp', 'tsp', 'tablespoon', 'tablespoons', 'teaspoon', 'teaspoons', 'clove', 'cloves', 'can', 'cans', 'tin', 'tins', 'jar', 'jars', 'bunch', 'bunches', 'head', 'heads', 'stick', 'sticks', 'slice', 'slices', 'sprig', 'sprigs', 'pinch', 'handful', 'bag', 'bags', 'box', 'boxes', 'pack', 'packs', 'packet', 'packets', 'bottle', 'bottles', 'piece', 'pieces', 'stalk', 'stalks', 'fillet', 'fillets', 'ear', 'ears'];
const UNIT_SET = new Set(UNITS);
const CANON: Record<string, string> = { cups: 'cup', tablespoon: 'tbsp', tablespoons: 'tbsp', teaspoon: 'tsp', teaspoons: 'tsp', lbs: 'lb', cloves: 'clove', cans: 'can', tins: 'tin', jars: 'jar', bunches: 'bunch', heads: 'head', sticks: 'stick', slices: 'slice', sprigs: 'sprig', bags: 'bag', boxes: 'box', packs: 'pack', packets: 'packet', bottles: 'bottle', pieces: 'piece', stalks: 'stalk', fillets: 'fillet', ears: 'ear' };

/** "1/2" → 0.5, "1 1/2" → 1.5, "2" → 2, "½" → 0.5; anything else ("a handful") → null. */
export function parseQuantity(q: string | null | undefined): number | null {
  if (!q) return null;
  const t = q
    .trim()
    .replace(/½/g, '1/2')
    .replace(/¼/g, '1/4')
    .replace(/¾/g, '3/4')
    .replace(/⅓/g, '1/3')
    .replace(/⅔/g, '2/3')
    .replace(/,/g, '.');
  const m = /^(\d+(?:\.\d+)?)?(?:\s*(?:(\d+)\/(\d+)))?$/.exec(t);
  if (!m || (!m[1] && !m[2])) {
    const range = /^(\d+(?:\.\d+)?)\s*(?:-|–|to)\s*(\d+(?:\.\d+)?)$/.exec(t);
    return range ? Number(range[2]) : null;
  }
  const whole = m[1] ? Number(m[1]) : 0;
  const frac = m[2] && m[3] && Number(m[3]) !== 0 ? Number(m[2]) / Number(m[3]) : 0;
  return whole + frac;
}

/** "2 lemons" → {2, null, "lemons"}; "500 g flour" → {500, "g", "flour"}; "olive oil" → {null, null, "olive oil"}. */
export function parseQuickAdd(input: string): { quantity: number | null; unit: string | null; text: string } {
  const s = input.replace(/\s+/g, ' ').trim();
  const m = /^((?:\d+(?:[.,]\d+)?\s*)?(?:\d+\/\d+|[½¼¾⅓⅔])?|\d+(?:[.,]\d+)?)\s*([a-zA-Z]+)?\.?\s+(.+)$/.exec(s);
  if (!m || !m[1] || !m[3]) return { quantity: null, unit: null, text: s };
  const quantity = parseQuantity(m[1]);
  if (quantity === null) return { quantity: null, unit: null, text: s };
  const maybeUnit = m[2]?.toLowerCase();
  if (maybeUnit && UNIT_SET.has(maybeUnit)) return { quantity, unit: CANON[maybeUnit] ?? maybeUnit, text: m[3].trim() };
  // "2 large lemons": the word after the number wasn't a unit, so it belongs to the item.
  return { quantity, unit: null, text: `${m[2] ? `${m[2]} ` : ''}${m[3]}`.trim() };
}

export function canonicalUnit(unit: string | null | undefined): string | null {
  if (!unit) return null;
  const u = unit.trim().toLowerCase().replace(/\.$/, '');
  if (!u) return null;
  return CANON[u] ?? u;
}

/** The aisle for a line: the library's category when the text names a known ingredient. */
export function categorize(text: string, ingredientId: string | null): { category: ListCategory; ingredientId: string | null } {
  const ing = ingredientId ? undefined : matchIngredient(text);
  const id = ingredientId ?? ing?.id ?? null;
  const cat = (ing?.category ?? (ingredientId ? matchIngredient(text)?.category : undefined)) as IngredientCategory | undefined;
  return { category: cat ?? 'other', ingredientId: id };
}

/** Round to something a person would write on a list: 1.3333 → 1.33, 0.5 → 0.5, 3 → 3. */
export function tidy(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A readable quantity: 0.5 → "½", 1.5 → "1½", 0.33 → "⅓", 250 → "250". */
export function formatQuantity(n: number | null): string {
  if (n === null) return '';
  const whole = Math.floor(n);
  const frac = n - whole;
  const glyph = frac === 0 ? '' : Math.abs(frac - 0.5) < 0.02 ? '½' : Math.abs(frac - 0.25) < 0.02 ? '¼' : Math.abs(frac - 0.75) < 0.02 ? '¾' : Math.abs(frac - 1 / 3) < 0.02 ? '⅓' : Math.abs(frac - 2 / 3) < 0.02 ? '⅔' : null;
  if (glyph === null) return String(tidy(n));
  return `${whole || (glyph ? '' : '0')}${glyph}`;
}
