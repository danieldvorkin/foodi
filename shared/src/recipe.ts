import { z } from 'zod';

export const DIFFICULTY = ['easy', 'medium', 'hard'] as const;
export const MEAL_TYPES = ['breakfast', 'lunch', 'dinner', 'snack', 'dessert', 'side', 'drink'] as const;
export const MEAL_EMOJI: Record<(typeof MEAL_TYPES)[number], string> = {
  breakfast: '🍳',
  lunch: '🥪',
  dinner: '🍽️',
  snack: '🍿',
  dessert: '🍰',
  side: '🥗',
  drink: '🥤',
};
export const DIFFICULTY_EMOJI = { easy: '🟢', medium: '🟡', hard: '🔴' } as const;
export const DIET_LABELS = [
  'vegan',
  'vegetarian',
  'pescatarian',
  'gluten-free',
  'dairy-free',
  'nut-free',
  'keto-friendly',
  'halal',
  'kosher',
  'high-protein',
  'low-carb',
] as const;
export const PREPARATIONS = [
  'whole',
  'diced',
  'minced',
  'sliced',
  'chopped',
  'grated',
  'julienned',
  'crushed',
  'zested',
  'juiced',
  'melted',
  'softened',
  'beaten',
  'toasted',
  'cooked',
] as const;

/** One line on the ingredient list. `ingredientId` links to the preset library when we can
 *  match it, so the UI can show allergens, substitutes and nutrition. */
export const RecipeIngredientSchema = z.object({
  item: z.string().trim().min(1).max(80),
  quantity: z.string().trim().max(30).nullable(),
  unit: z.string().trim().max(30).nullable(),
  preparation: z.string().trim().max(40).nullable(),
  note: z.string().trim().max(120).nullable(),
  group: z.string().trim().max(40).nullable(),
  optional: z.boolean(),
  ingredientId: z.string().trim().max(60).nullable(),
});

export const StepSchema = z.object({
  title: z.string().trim().min(1).max(60),
  text: z.string().trim().min(1).max(700),
  /** Seconds for a timer that starts when the person taps it. Null when the step is untimed. */
  timerSeconds: z.number().int().min(0).max(24 * 3600).nullable(),
  /** Indexes into `ingredients` used in this step, so cook mode can show "you need". */
  ingredientRefs: z.array(z.number().int().min(0).max(99)).max(20),
  /** e.g. "Oven 200°C / 400°F", "Medium-high heat". */
  temperature: z.string().trim().max(60).nullable(),
  tip: z.string().trim().max(300).nullable(),
});

export const NutritionSchema = z.object({
  calories: z.number().min(0).max(5000),
  proteinGrams: z.number().min(0).max(500),
  carbsGrams: z.number().min(0).max(1000),
  fatGrams: z.number().min(0).max(500),
  fiberGrams: z.number().min(0).max(200).nullable(),
  sugarGrams: z.number().min(0).max(500).nullable(),
  sodiumMg: z.number().min(0).max(20000).nullable(),
});

export const SubstitutionSchema = z.object({
  ingredient: z.string().trim().min(1).max(80),
  swap: z.string().trim().min(1).max(120),
  why: z.string().trim().max(160).nullable(),
});

/** What the model must produce. Every field is required (nullable where optional) so the
 *  same JSON schema works for OpenAI strict mode and Anthropic tool input. */
export const RecipeContentSchema = z.object({
  /** One emoji that best represents the dish. Shown wherever the recipe appears. */
  emoji: z.string().trim().min(1).max(8).default('🍽️'),
  title: z.string().trim().min(1).max(120),
  summary: z.string().trim().min(1).max(400),
  cuisine: z.string().trim().max(40).nullable(),
  mealType: z.enum(MEAL_TYPES),
  servings: z.number().int().min(1).max(24),
  totalMinutes: z.number().int().min(1).max(24 * 60),
  activeMinutes: z.number().int().min(1).max(24 * 60),
  difficulty: z.enum(DIFFICULTY),
  dietLabels: z.array(z.enum(DIET_LABELS)).max(8),
  tags: z.array(z.string().trim().min(1).max(30)).max(8),
  allergens: z.array(z.string().trim().min(1).max(30)).max(12),
  equipment: z.array(z.string().trim().min(1).max(40)).max(12),
  techniques: z.array(z.string().trim().min(1).max(40)).max(8),
  ingredients: z.array(RecipeIngredientSchema).min(1).max(40),
  steps: z.array(StepSchema).min(1).max(30),
  substitutions: z.array(SubstitutionSchema).max(10),
  makeAhead: z.string().trim().max(300).nullable(),
  storage: z.string().trim().max(300).nullable(),
  nutritionPerServing: NutritionSchema.nullable(),
});

export type RecipeContent = z.infer<typeof RecipeContentSchema>;
export type RecipeIngredient = z.infer<typeof RecipeIngredientSchema>;
export type Step = z.infer<typeof StepSchema>;
export type Nutrition = z.infer<typeof NutritionSchema>;

export const MediaItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['image', 'video']),
  mime: z.string(),
  width: z.number().nullable(),
  height: z.number().nullable(),
  bytes: z.number(),
  createdAt: z.string(),
  /** Made by the AI rather than uploaded; shown with an "AI photo" caption. */
  generated: z.boolean().default(false),
});
export type MediaItem = z.infer<typeof MediaItemSchema>;

export const RecipeSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  favorite: z.boolean(),
  prompt: z.string(),
  /** Library ingredient ids the person asked us to cook with. */
  requestedIngredientIds: z.array(z.string()),
  provider: z.string(),
  model: z.string(),
  /** Allergens in this recipe that intersect the person's profile. Computed server-side. */
  warnings: z.array(z.string()),
  media: z.array(MediaItemSchema),
  content: RecipeContentSchema,
  /** Set when this recipe was copied from someone's shared recipe and adapted. */
  adaptedFrom: z.object({ id: z.string().nullable(), title: z.string(), handle: z.string(), stillPublic: z.boolean() }).nullable(),
  /** The cook's own notes on what they changed from the original. */
  revisionNotes: z.string(),
  /** How many people have adapted this recipe. */
  adaptationCount: z.number(),
});
export type Recipe = z.infer<typeof RecipeSchema>;

export const RecipeSummarySchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  favorite: z.boolean(),
  emoji: z.string(),
  cover: MediaItemSchema.nullable(),
  title: z.string(),
  summary: z.string(),
  mealType: z.enum(MEAL_TYPES),
  totalMinutes: z.number(),
  difficulty: z.enum(DIFFICULTY),
  servings: z.number(),
  warnings: z.array(z.string()),
});
export type RecipeSummary = z.infer<typeof RecipeSummarySchema>;

export const GenerateRequestSchema = z.object({
  prompt: z.string().trim().max(500),
  /** Preset ingredient ids the recipe must use (from the drag-and-drop basket). */
  ingredientIds: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
  /** Regenerate from an existing recipe with a tweak ("make it vegan", "halve it"). */
  basedOnRecipeId: z.string().optional(),
  servings: z.number().int().min(1).max(24).optional(),
  timeBudgetMinutes: z.number().int().min(10).max(240).optional(),
  mealType: z.enum(MEAL_TYPES).optional(),
  /** For "randomize": dishes to steer away from, and a salt so the offline chef re-rolls. */
  avoidTitles: z.array(z.string().trim().max(120)).max(5).default([]),
  seed: z.string().trim().max(40).optional(),
});
export type GenerateRequest = z.infer<typeof GenerateRequestSchema>;

export const PantrySchema = z.object({
  ingredientIds: z.array(z.string().trim().min(1).max(60)).max(200),
});
export type Pantry = z.infer<typeof PantrySchema>;
