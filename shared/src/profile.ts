import { z } from 'zod';

export const DIETS = [
  'omnivore',
  'vegetarian',
  'vegan',
  'pescatarian',
  'keto',
  'halal',
  'kosher',
  'gluten-free',
] as const;

export const SKILLS = ['beginner', 'comfortable', 'confident'] as const;
export const SPICE = ['mild', 'medium', 'hot'] as const;
export const UNITS = ['metric', 'imperial'] as const;

export const COMMON_ALLERGENS = [
  'peanuts',
  'tree nuts',
  'dairy',
  'eggs',
  'gluten',
  'soy',
  'shellfish',
  'fish',
  'sesame',
] as const;

export const CUISINES = [
  'Italian',
  'Mexican',
  'Japanese',
  'Chinese',
  'Thai',
  'Indian',
  'Mediterranean',
  'Middle Eastern',
  'French',
  'Korean',
  'American',
  'Vietnamese',
] as const;

export const EQUIPMENT = [
  'stovetop',
  'oven',
  'microwave',
  'air fryer',
  'blender',
  'food processor',
  'pressure cooker',
  'slow cooker',
  'grill',
  'cast iron pan',
  'stand mixer',
  'rice cooker',
] as const;

export const GOALS = [
  'quick weeknights',
  'eat healthier',
  'save money',
  'learn technique',
  'high protein',
  'cook for kids',
  'impress someone',
  'use what I have',
] as const;

export const TIME_BUDGETS = [15, 30, 45, 60, 90] as const;

const shortText = z.string().trim().min(1).max(60);

export const ProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(40),
  units: z.enum(UNITS),
  diet: z.enum(DIETS),
  allergies: z.array(shortText).max(20),
  dislikes: z.array(shortText).max(30),
  cuisines: z.array(shortText).max(12),
  skill: z.enum(SKILLS),
  spice: z.enum(SPICE),
  timeBudgetMinutes: z.number().int().min(10).max(240),
  householdSize: z.number().int().min(1).max(12),
  equipment: z.array(shortText).max(20),
  goals: z.array(shortText).max(8),
});

export type Profile = z.infer<typeof ProfileSchema>;

export const emptyProfile: Profile = {
  displayName: '',
  units: 'metric',
  diet: 'omnivore',
  allergies: [],
  dislikes: [],
  cuisines: [],
  skill: 'comfortable',
  spice: 'medium',
  timeBudgetMinutes: 30,
  householdSize: 2,
  equipment: ['stovetop', 'oven'],
  goals: [],
};
