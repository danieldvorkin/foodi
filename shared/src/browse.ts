import { z } from 'zod';
import { DIET_LABELS, DIFFICULTY, MEAL_TYPES, MediaItemSchema, RecipeIngredientSchema } from './recipe.js';

/** What a visitor without an account sees of a public recipe: enough to want it. */
export const BrowseRecipeSchema = z.object({
  id: z.string(),
  emoji: z.string(),
  title: z.string(),
  summary: z.string(),
  mealType: z.enum(MEAL_TYPES),
  cuisine: z.string().nullable(),
  totalMinutes: z.number(),
  difficulty: z.enum(DIFFICULTY),
  servings: z.number(),
  dietLabels: z.array(z.string()),
  tags: z.array(z.string()),
  /** Anonymous cover URL (`/share/recipes/:id/cover.ext`) or null. */
  cover: z.string().nullable(),
  author: z.object({ handle: z.string(), displayName: z.string(), avatar: z.string(), isHouse: z.boolean() }),
  createdAt: z.string(),
});
export type BrowseRecipe = z.infer<typeof BrowseRecipeSchema>;

export const BrowseQuerySchema = z.object({
  q: z.string().trim().max(80).default(''),
  meal: z.enum(MEAL_TYPES).optional(),
  diet: z.enum(DIET_LABELS).optional(),
  difficulty: z.enum(DIFFICULTY).optional(),
  /** Upper bound on total minutes. */
  maxMinutes: z.coerce.number().int().min(5).max(600).optional(),
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(48).default(24),
});
export type BrowseQuery = z.infer<typeof BrowseQuerySchema>;

/** The teaser: everything but the method. Steps come as titles only until they sign in. */
export const BrowseRecipeDetailSchema = BrowseRecipeSchema.extend({
  ingredients: z.array(RecipeIngredientSchema),
  stepTitles: z.array(z.string()),
  stepCount: z.number(),
  activeMinutes: z.number(),
  equipment: z.array(z.string()),
  allergens: z.array(z.string()),
  media: z.array(MediaItemSchema.pick({ id: true, kind: true, width: true, height: true, credit: true, license: true, sourceUrl: true, source: true, generated: true }).extend({ url: z.string() })),
});
export type BrowseRecipeDetail = z.infer<typeof BrowseRecipeDetailSchema>;

export const TIME_FILTERS = [15, 30, 45, 60] as const;
