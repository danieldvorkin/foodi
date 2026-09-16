import type { DIET_LABELS, DIFFICULTY, MEAL_TYPES } from '@foodi/shared';

/**
 * Compact authoring format for the house recipes. Ingredients are plain strings
 * ("2 tbsp olive oil", "1 onion, diced", "?1 tsp chili flakes" = optional, "Sauce: 2 tbsp soy sauce"
 * = group) and steps are tuples; `toContent()` expands them into RecipeContent.
 */
export interface SeedRecipe {
  emoji: string;
  title: string;
  summary: string;
  cuisine: string;
  meal: (typeof MEAL_TYPES)[number];
  serves: number;
  total: number;
  active: number;
  level: (typeof DIFFICULTY)[number];
  diet: (typeof DIET_LABELS)[number][];
  tags: string[];
  allergens?: string[];
  equipment: string[];
  techniques: string[];
  ing: string[];
  /** [title, text, timerSeconds?, temperature?, tip?] */
  steps: [string, string, (number | null)?, (string | null)?, (string | null)?][];
  /** [ingredient, swap, why?] */
  subs?: [string, string, string?][];
  makeAhead?: string;
  storage?: string;
  /** kcal, protein g, carbs g, fat g per serving */
  n: [number, number, number, number];
  /** The kitchen's post caption when it shares the recipe. */
  caption: string;
  /** Spread the posts over the past weeks so the feed doesn't look like one dump. */
  daysAgo: number;
}
