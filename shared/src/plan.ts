import { z } from 'zod';

/** Meal slots in the order they appear on a day, plus a lane for batch-cooking sessions. */
export const PLAN_SLOTS = ['breakfast', 'lunch', 'dinner', 'snack', 'prep'] as const;
export type PlanSlot = (typeof PLAN_SLOTS)[number];
export const PLAN_SLOT_LABEL: Record<PlanSlot, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', prep: 'Prep' };
export const PLAN_SLOT_EMOJI: Record<PlanSlot, string> = { breakfast: '🌅', lunch: '🥪', dinner: '🍽️', snack: '🍎', prep: '🔪' };

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

export const PlanEntrySchema = z.object({
  id: z.string(),
  date: DATE,
  slot: z.enum(PLAN_SLOTS),
  /** Null when the recipe was deleted or is a free-text plan ("leftovers"). */
  recipeId: z.string().nullable(),
  title: z.string(),
  emoji: z.string(),
  servings: z.number().int().min(1).max(48),
  note: z.string(),
  done: z.boolean(),
  position: z.number(),
  /** Whether the recipe behind it can still be opened by this person. */
  recipeAvailable: z.boolean(),
  createdAt: z.string(),
});
export type PlanEntry = z.infer<typeof PlanEntrySchema>;

export const CreatePlanEntrySchema = z
  .object({
    date: DATE,
    slot: z.enum(PLAN_SLOTS),
    recipeId: z.string().min(1).optional(),
    /** Free text when there's no recipe: "leftovers", "eating out". */
    title: z.string().trim().min(1).max(80).optional(),
    emoji: z.string().trim().max(8).optional(),
    servings: z.number().int().min(1).max(48).optional(),
    note: z.string().trim().max(300).default(''),
  })
  .refine((v) => v.recipeId || v.title, 'Pick a recipe or type a dish.');
export type CreatePlanEntry = z.infer<typeof CreatePlanEntrySchema>;

export const UpdatePlanEntrySchema = z
  .object({
    date: DATE.optional(),
    slot: z.enum(PLAN_SLOTS).optional(),
    servings: z.number().int().min(1).max(48).optional(),
    note: z.string().trim().max(300).optional(),
    done: z.boolean().optional(),
    title: z.string().trim().min(1).max(80).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, 'Nothing to change.');

/** Monday-first weeks: the Monday on or before a date, as YYYY-MM-DD. */
export function weekStart(date: string): string {
  const d = parseDate(date);
  const dow = (d.getUTCDay() + 6) % 7; // Monday = 0
  d.setUTCDate(d.getUTCDate() - dow);
  return isoDate(d);
}
export function addDays(date: string, n: number): string {
  const d = parseDate(date);
  d.setUTCDate(d.getUTCDate() + n);
  return isoDate(d);
}
/** The seven dates of the week that contains `date`. */
export function weekDates(date: string): string[] {
  const start = weekStart(date);
  return Array.from({ length: 7 }, (_, i) => addDays(start, i));
}
export function parseDate(date: string): Date {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d!));
}
export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
/** Today in the person's own timezone, as YYYY-MM-DD (client-side use). */
export function todayLocal(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
/** "Mon 3 Jun" style label; `short` gives just "Mon". */
export function dayLabel(date: string, short = false): string {
  const d = parseDate(date);
  const names = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dow = names[d.getUTCDay()]!;
  return short ? dow : `${dow} ${d.getUTCDate()} ${months[d.getUTCMonth()]}`;
}
export function weekLabel(start: string): string {
  const end = addDays(start, 6);
  const a = parseDate(start);
  const b = parseDate(end);
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return a.getUTCMonth() === b.getUTCMonth() ? `${a.getUTCDate()}–${b.getUTCDate()} ${months[a.getUTCMonth()]}` : `${a.getUTCDate()} ${months[a.getUTCMonth()]} – ${b.getUTCDate()} ${months[b.getUTCMonth()]}`;
}
