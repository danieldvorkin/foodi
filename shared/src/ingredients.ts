/**
 * Preset ingredient library. Shared by the client (drag-and-drop basket, allergen badges)
 * and the server (linking model output to presets, mock recipes, diet checks).
 *
 * Nutrition is approximate, per 100 g raw unless noted, and is only used for estimates.
 * Diet suitability is derived from `animal`, `alcohol` and `gluten` — it is a helpful
 * default, not a certification (halal/kosher also depend on sourcing and preparation).
 */

export const INGREDIENT_CATEGORIES = [
  'vegetables',
  'fruit',
  'meat',
  'poultry',
  'seafood',
  'eggs & dairy',
  'grains & pasta',
  'legumes',
  'nuts & seeds',
  'herbs & spices',
  'oils & condiments',
  'baking',
] as const;
export type IngredientCategory = (typeof INGREDIENT_CATEGORIES)[number];

export const CATEGORY_EMOJI: Record<IngredientCategory, string> = {
  vegetables: '🥬',
  fruit: '🍎',
  meat: '🥩',
  poultry: '🍗',
  seafood: '🐟',
  'eggs & dairy': '🥚',
  'grains & pasta': '🌾',
  legumes: '🫘',
  'nuts & seeds': '🥜',
  'herbs & spices': '🌿',
  'oils & condiments': '🫒',
  baking: '🧁',
};

/** Specific emoji where one exists; everything else falls back to its category. */
const INGREDIENT_EMOJI: Record<string, string> = {
  onion: '🧅', 'red-onion': '🧅', shallot: '🧅', garlic: '🧄', ginger: '🫚', tomato: '🍅', 'cherry-tomato': '🍅', 'canned-tomatoes': '🥫', 'tomato-paste': '🥫',
  'bell-pepper': '🫑', chili: '🌶️', carrot: '🥕', potato: '🥔', 'sweet-potato': '🍠', 'butternut-squash': '🎃', pumpkin: '🎃', zucchini: '🥒', eggplant: '🍆', cucumber: '🥒',
  broccoli: '🥦', cauliflower: '🥦', cabbage: '🥬', kale: '🥬', spinach: '🥬', lettuce: '🥬', mushroom: '🍄', corn: '🌽', peas: '🫛', 'green-beans': '🫛', avocado: '🥑', olives: '🫒', leek: '🧅',
  lemon: '🍋', lime: '🍋‍🟩', orange: '🍊', apple: '🍎', pear: '🍐', banana: '🍌', berries: '🫐', mango: '🥭', pineapple: '🍍', grapes: '🍇', dates: '🌴', 'coconut-milk': '🥥',
  'ground-beef': '🥩', 'beef-steak': '🥩', 'beef-stew': '🥩', 'pork-chop': '🥩', 'pork-shoulder': '🥩', bacon: '🥓', pancetta: '🥓', sausage: '🌭', chorizo: '🌭', lamb: '🍖',
  'chicken-breast': '🍗', 'chicken-thigh': '🍗', 'whole-chicken': '🍗', 'chicken-wings': '🍗', 'ground-turkey': '🦃', 'ground-chicken': '🍗', 'duck-breast': '🦆',
  salmon: '🐟', cod: '🐟', trout: '🐟', 'tuna-canned': '🥫', shrimp: '🍤', mussels: '🦪', squid: '🦑', anchovies: '🐟',
  egg: '🥚', butter: '🧈', milk: '🥛', 'oat-milk': '🥛', 'heavy-cream': '🥛', yogurt: '🥣', 'sour-cream': '🥣', parmesan: '🧀', cheddar: '🧀', mozzarella: '🧀', feta: '🧀', 'goat-cheese': '🧀', gruyere: '🧀', 'cream-cheese': '🧀', ricotta: '🧀', tofu: '🧊', tempeh: '🧊',
  rice: '🍚', 'arborio-rice': '🍚', 'brown-rice': '🍚', quinoa: '🌾', pasta: '🍝', 'gf-pasta': '🍝', 'egg-noodles': '🍜', 'rice-noodles': '🍜', couscous: '🌾', bulgur: '🌾', oats: '🥣', bread: '🍞', tortilla: '🌮', pita: '🫓', breadcrumbs: '🍞', polenta: '🌽',
  chickpeas: '🫘', 'black-beans': '🫘', 'kidney-beans': '🫘', 'pinto-beans': '🫘', 'white-beans': '🫘', lentils: '🫘', edamame: '🫛',
  almonds: '🌰', walnuts: '🌰', pecans: '🌰', cashews: '🌰', peanuts: '🥜', 'peanut-butter': '🥜', 'almond-butter': '🌰', 'pine-nuts': '🌰', 'sesame-seeds': '🌱', tahini: '🌱', 'sunflower-seeds': '🌻', 'chia-seeds': '🌱', 'pumpkin-seeds': '🎃',
  salt: '🧂', 'black-pepper': '🌶️', 'chili-flakes': '🌶️', cayenne: '🌶️', 'chili-powder': '🌶️', basil: '🌿', parsley: '🌿', cilantro: '🌿', mint: '🌿', dill: '🌿', chives: '🌿', rosemary: '🌿', thyme: '🌿', 'bay-leaf': '🍃', cinnamon: '🪵', vanilla: '🌼',
  'olive-oil': '🫒', 'vegetable-oil': '🫙', 'sesame-oil': '🫙', 'coconut-oil': '🥥', 'soy-sauce': '🍶', tamari: '🍶', 'fish-sauce': '🐟', vinegar: '🍶', 'rice-vinegar': '🍶', balsamic: '🍶', dijon: '🟡', mayonnaise: '🥚', ketchup: '🍅', 'hot-sauce': '🌶️', miso: '🍲', gochujang: '🌶️', harissa: '🌶️', 'curry-paste': '🍛', honey: '🍯', 'maple-syrup': '🍁', stock: '🍲', capers: '🫙', 'white-wine': '🍷',
  flour: '🌾', 'gf-flour': '🌾', 'almond-flour': '🌰', cornstarch: '🌽', sugar: '🍬', 'brown-sugar': '🍬', 'baking-powder': '🧁', 'baking-soda': '🧁', yeast: '🍞', cocoa: '🍫', 'dark-chocolate': '🍫', 'puff-pastry': '🥐',
};

export function ingredientEmoji(i: { id: string; category: IngredientCategory }): string {
  return INGREDIENT_EMOJI[i.id] ?? CATEGORY_EMOJI[i.category];
}

export type AnimalSource =
  | 'beef'
  | 'pork'
  | 'lamb'
  | 'poultry'
  | 'fish'
  | 'shellfish'
  | 'dairy'
  | 'egg'
  | 'honey';

export type Storage = 'pantry' | 'fridge' | 'freezer' | 'counter';

export interface Ingredient {
  id: string;
  emoji: string;
  name: string;
  plural: string;
  category: IngredientCategory;
  aliases: string[];
  /** Common allergen groups this ingredient triggers. */
  allergens: string[];
  animal: AnimalSource | null;
  alcohol: boolean;
  gluten: boolean;
  defaultUnit: string;
  units: string[];
  nutritionPer100g: { kcal: number; protein: number; carbs: number; fat: number; fiber: number };
  storage: Storage;
  shelfLifeDays: number | null;
  /** Ids of reasonable swaps. */
  substitutes: string[];
  suitableFor: {
    vegan: boolean;
    vegetarian: boolean;
    pescatarian: boolean;
    glutenFree: boolean;
    dairyFree: boolean;
    ketoFriendly: boolean;
    halal: boolean;
    kosher: boolean;
  };
}

type Def = {
  id: string;
  name: string;
  plural?: string;
  cat: IngredientCategory;
  aliases?: string[];
  allergens?: string[];
  animal?: AnimalSource;
  alcohol?: boolean;
  gluten?: boolean;
  unit?: string;
  units?: string[];
  n: [kcal: number, protein: number, carbs: number, fat: number, fiber?: number];
  storage?: Storage;
  life?: number;
  subs?: string[];
};

const UNIT_SETS = {
  weight: ['g', 'kg', 'oz', 'lb'],
  count: ['piece', 'whole'],
  volume: ['ml', 'l', 'cup', 'tbsp', 'tsp'],
  spice: ['tsp', 'tbsp', 'pinch', 'g'],
  herb: ['sprig', 'bunch', 'tbsp', 'g'],
};

function build(d: Def): Ingredient {
  const animal = d.animal ?? null;
  const alcohol = d.alcohol ?? false;
  const gluten = d.gluten ?? false;
  const meat = animal === 'beef' || animal === 'pork' || animal === 'lamb' || animal === 'poultry';
  const sea = animal === 'fish' || animal === 'shellfish';
  const carbs = d.n[2];
  const allergens = [...(d.allergens ?? [])];
  if (animal === 'dairy' && !allergens.includes('dairy')) allergens.push('dairy');
  if (animal === 'egg' && !allergens.includes('eggs')) allergens.push('eggs');
  if (animal === 'fish' && !allergens.includes('fish')) allergens.push('fish');
  if (animal === 'shellfish' && !allergens.includes('shellfish')) allergens.push('shellfish');
  if (gluten && !allergens.includes('gluten')) allergens.push('gluten');
  return {
    id: d.id,
    emoji: INGREDIENT_EMOJI[d.id] ?? CATEGORY_EMOJI[d.cat],
    name: d.name,
    plural: d.plural ?? d.name,
    category: d.cat,
    aliases: d.aliases ?? [],
    allergens,
    animal,
    alcohol,
    gluten,
    defaultUnit: d.unit ?? (d.units?.[0] ?? 'g'),
    units: d.units ?? UNIT_SETS.weight,
    nutritionPer100g: { kcal: d.n[0], protein: d.n[1], carbs: d.n[2], fat: d.n[3], fiber: d.n[4] ?? 0 },
    storage: d.storage ?? 'pantry',
    shelfLifeDays: d.life ?? null,
    substitutes: d.subs ?? [],
    suitableFor: {
      vegan: animal === null,
      vegetarian: !meat && !sea,
      pescatarian: !meat,
      glutenFree: !gluten,
      dairyFree: animal !== 'dairy',
      ketoFriendly: carbs <= 8,
      halal: animal !== 'pork' && !alcohol,
      kosher: animal !== 'pork' && animal !== 'shellfish',
    },
  };
}

const V = 'vegetables';
const F = 'fruit';
const M = 'meat';
const P = 'poultry';
const S = 'seafood';
const D = 'eggs & dairy';
const G = 'grains & pasta';
const L = 'legumes';
const N = 'nuts & seeds';
const H = 'herbs & spices';
const O = 'oils & condiments';
const B = 'baking';

const defs: Def[] = [
  // vegetables
  { id: 'onion', name: 'onion', plural: 'onions', cat: V, aliases: ['yellow onion', 'brown onion'], unit: 'piece', units: UNIT_SETS.count, n: [40, 1.1, 9.3, 0.1, 1.7], storage: 'counter', life: 30, subs: ['shallot', 'leek'] },
  { id: 'red-onion', name: 'red onion', plural: 'red onions', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [40, 1.1, 9.3, 0.1, 1.7], storage: 'counter', life: 30, subs: ['onion', 'shallot'] },
  { id: 'shallot', name: 'shallot', plural: 'shallots', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [72, 2.5, 16.8, 0.1, 3.2], storage: 'counter', life: 30, subs: ['onion'] },
  { id: 'garlic', name: 'garlic', cat: V, aliases: ['garlic clove'], unit: 'clove', units: ['clove', 'head', 'tsp'], n: [149, 6.4, 33, 0.5, 2.1], storage: 'counter', life: 60 },
  { id: 'ginger', name: 'ginger', cat: V, aliases: ['fresh ginger', 'ginger root'], unit: 'cm', units: ['cm', 'inch', 'tbsp', 'g'], n: [80, 1.8, 17.8, 0.8, 2], storage: 'fridge', life: 21 },
  { id: 'tomato', name: 'tomato', plural: 'tomatoes', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [18, 0.9, 3.9, 0.2, 1.2], storage: 'counter', life: 7, subs: ['canned-tomatoes'] },
  { id: 'cherry-tomato', name: 'cherry tomato', plural: 'cherry tomatoes', cat: V, n: [18, 0.9, 3.9, 0.2, 1.2], storage: 'counter', life: 7, subs: ['tomato'] },
  { id: 'canned-tomatoes', name: 'canned tomatoes', cat: V, aliases: ['tinned tomatoes', 'crushed tomatoes', 'diced tomatoes'], unit: 'can', units: ['can', 'g', 'cup'], n: [24, 1.2, 4.5, 0.2, 1.3], life: 720, subs: ['tomato', 'tomato-paste'] },
  { id: 'tomato-paste', name: 'tomato paste', cat: V, aliases: ['tomato purée'], unit: 'tbsp', units: ['tbsp', 'g'], n: [82, 4.3, 18.9, 0.5, 4.1], storage: 'fridge', life: 30 },
  { id: 'bell-pepper', name: 'bell pepper', plural: 'bell peppers', cat: V, aliases: ['capsicum', 'sweet pepper'], unit: 'piece', units: UNIT_SETS.count, n: [26, 1, 6, 0.3, 2], storage: 'fridge', life: 10 },
  { id: 'chili', name: 'fresh chili', plural: 'fresh chilies', cat: V, aliases: ['chile', 'jalapeño', 'red chili'], unit: 'piece', units: UNIT_SETS.count, n: [40, 1.9, 8.8, 0.4, 1.5], storage: 'fridge', life: 14, subs: ['chili-flakes'] },
  { id: 'carrot', name: 'carrot', plural: 'carrots', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [41, 0.9, 9.6, 0.2, 2.8], storage: 'fridge', life: 21 },
  { id: 'celery', name: 'celery', cat: V, unit: 'stalk', units: ['stalk', 'cup', 'g'], n: [16, 0.7, 3, 0.2, 1.6], storage: 'fridge', life: 14 },
  { id: 'potato', name: 'potato', plural: 'potatoes', cat: V, aliases: ['russet', 'yukon gold'], unit: 'piece', units: UNIT_SETS.count, n: [77, 2, 17, 0.1, 2.2], storage: 'counter', life: 30, subs: ['sweet-potato'] },
  { id: 'sweet-potato', name: 'sweet potato', plural: 'sweet potatoes', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [86, 1.6, 20, 0.1, 3], storage: 'counter', life: 21, subs: ['potato', 'butternut-squash'] },
  { id: 'butternut-squash', name: 'butternut squash', cat: V, n: [45, 1, 11.7, 0.1, 2], storage: 'counter', life: 60, subs: ['sweet-potato', 'pumpkin'] },
  { id: 'pumpkin', name: 'pumpkin', cat: V, n: [26, 1, 6.5, 0.1, 0.5], storage: 'counter', life: 60, subs: ['butternut-squash'] },
  { id: 'zucchini', name: 'zucchini', plural: 'zucchini', cat: V, aliases: ['courgette'], unit: 'piece', units: UNIT_SETS.count, n: [17, 1.2, 3.1, 0.3, 1], storage: 'fridge', life: 7 },
  { id: 'eggplant', name: 'eggplant', plural: 'eggplants', cat: V, aliases: ['aubergine'], unit: 'piece', units: UNIT_SETS.count, n: [25, 1, 5.9, 0.2, 3], storage: 'fridge', life: 7 },
  { id: 'cucumber', name: 'cucumber', plural: 'cucumbers', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [15, 0.7, 3.6, 0.1, 0.5], storage: 'fridge', life: 7 },
  { id: 'broccoli', name: 'broccoli', cat: V, unit: 'head', units: ['head', 'cup', 'g'], n: [34, 2.8, 6.6, 0.4, 2.6], storage: 'fridge', life: 7, subs: ['cauliflower'] },
  { id: 'cauliflower', name: 'cauliflower', cat: V, unit: 'head', units: ['head', 'cup', 'g'], n: [25, 1.9, 5, 0.3, 2], storage: 'fridge', life: 7, subs: ['broccoli'] },
  { id: 'cabbage', name: 'cabbage', cat: V, unit: 'head', units: ['head', 'cup', 'g'], n: [25, 1.3, 5.8, 0.1, 2.5], storage: 'fridge', life: 21 },
  { id: 'kale', name: 'kale', cat: V, unit: 'bunch', units: ['bunch', 'cup', 'g'], n: [49, 4.3, 8.8, 0.9, 3.6], storage: 'fridge', life: 7, subs: ['spinach', 'chard'] },
  { id: 'spinach', name: 'spinach', cat: V, unit: 'handful', units: ['handful', 'cup', 'g'], n: [23, 2.9, 3.6, 0.4, 2.2], storage: 'fridge', life: 5, subs: ['kale', 'chard'] },
  { id: 'chard', name: 'Swiss chard', cat: V, unit: 'bunch', units: ['bunch', 'cup', 'g'], n: [19, 1.8, 3.7, 0.2, 1.6], storage: 'fridge', life: 5, subs: ['spinach', 'kale'] },
  { id: 'lettuce', name: 'lettuce', cat: V, aliases: ['romaine', 'butter lettuce'], unit: 'head', units: ['head', 'cup', 'g'], n: [15, 1.4, 2.9, 0.2, 1.3], storage: 'fridge', life: 7 },
  { id: 'arugula', name: 'arugula', cat: V, aliases: ['rocket'], unit: 'handful', units: ['handful', 'cup', 'g'], n: [25, 2.6, 3.7, 0.7, 1.6], storage: 'fridge', life: 4 },
  { id: 'mushroom', name: 'mushroom', plural: 'mushrooms', cat: V, aliases: ['cremini', 'button mushroom', 'shiitake'], n: [22, 3.1, 3.3, 0.3, 1], storage: 'fridge', life: 7 },
  { id: 'asparagus', name: 'asparagus', cat: V, unit: 'bunch', units: ['bunch', 'spear', 'g'], n: [20, 2.2, 3.9, 0.1, 2.1], storage: 'fridge', life: 4 },
  { id: 'green-beans', name: 'green beans', cat: V, n: [31, 1.8, 7, 0.2, 2.7], storage: 'fridge', life: 7 },
  { id: 'peas', name: 'peas', cat: V, aliases: ['frozen peas', 'garden peas'], unit: 'cup', units: ['cup', 'g'], n: [81, 5.4, 14.5, 0.4, 5.1], storage: 'freezer', life: 365 },
  { id: 'corn', name: 'corn', cat: V, aliases: ['sweetcorn', 'corn kernels'], unit: 'cup', units: ['cup', 'ear', 'g'], n: [86, 3.3, 19, 1.2, 2.7], storage: 'freezer', life: 365 },
  { id: 'leek', name: 'leek', plural: 'leeks', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [61, 1.5, 14, 0.3, 1.8], storage: 'fridge', life: 14, subs: ['onion'] },
  { id: 'spring-onion', name: 'spring onion', plural: 'spring onions', cat: V, aliases: ['scallion', 'green onion'], unit: 'piece', units: UNIT_SETS.count, n: [32, 1.8, 7.3, 0.2, 2.6], storage: 'fridge', life: 7 },
  { id: 'beet', name: 'beet', plural: 'beets', cat: V, aliases: ['beetroot'], unit: 'piece', units: UNIT_SETS.count, n: [43, 1.6, 9.6, 0.2, 2.8], storage: 'fridge', life: 21 },
  { id: 'avocado', name: 'avocado', plural: 'avocados', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [160, 2, 8.5, 14.7, 6.7], storage: 'counter', life: 5 },
  { id: 'bok-choy', name: 'bok choy', cat: V, aliases: ['pak choi'], unit: 'head', units: ['head', 'g'], n: [13, 1.5, 2.2, 0.2, 1], storage: 'fridge', life: 5 },
  { id: 'radish', name: 'radish', plural: 'radishes', cat: V, unit: 'piece', units: UNIT_SETS.count, n: [16, 0.7, 3.4, 0.1, 1.6], storage: 'fridge', life: 10 },
  { id: 'fennel', name: 'fennel', cat: V, unit: 'bulb', units: ['bulb', 'g'], n: [31, 1.2, 7.3, 0.2, 3.1], storage: 'fridge', life: 10 },
  { id: 'olives', name: 'olives', cat: V, unit: 'cup', units: ['cup', 'g'], n: [115, 0.8, 6.3, 10.7, 3.2], storage: 'fridge', life: 90 },
  // fruit
  { id: 'lemon', name: 'lemon', plural: 'lemons', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [29, 1.1, 9.3, 0.3, 2.8], storage: 'counter', life: 21, subs: ['lime'] },
  { id: 'lime', name: 'lime', plural: 'limes', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [30, 0.7, 10.5, 0.2, 2.8], storage: 'counter', life: 21, subs: ['lemon'] },
  { id: 'orange', name: 'orange', plural: 'oranges', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [47, 0.9, 11.8, 0.1, 2.4], storage: 'counter', life: 14 },
  { id: 'apple', name: 'apple', plural: 'apples', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [52, 0.3, 13.8, 0.2, 2.4], storage: 'fridge', life: 30, subs: ['pear'] },
  { id: 'pear', name: 'pear', plural: 'pears', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [57, 0.4, 15.2, 0.1, 3.1], storage: 'fridge', life: 14, subs: ['apple'] },
  { id: 'banana', name: 'banana', plural: 'bananas', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [89, 1.1, 22.8, 0.3, 2.6], storage: 'counter', life: 5 },
  { id: 'berries', name: 'mixed berries', cat: F, aliases: ['strawberries', 'blueberries', 'raspberries'], unit: 'cup', units: ['cup', 'g'], n: [50, 0.7, 12, 0.3, 3], storage: 'fridge', life: 4 },
  { id: 'mango', name: 'mango', plural: 'mangoes', cat: F, unit: 'piece', units: UNIT_SETS.count, n: [60, 0.8, 15, 0.4, 1.6], storage: 'counter', life: 5 },
  { id: 'pineapple', name: 'pineapple', cat: F, unit: 'cup', units: ['cup', 'piece', 'g'], n: [50, 0.5, 13.1, 0.1, 1.4], storage: 'fridge', life: 5 },
  { id: 'grapes', name: 'grapes', cat: F, unit: 'cup', units: ['cup', 'g'], n: [69, 0.7, 18.1, 0.2, 0.9], storage: 'fridge', life: 7 },
  { id: 'dates', name: 'dates', cat: F, aliases: ['medjool dates'], unit: 'piece', units: UNIT_SETS.count, n: [277, 1.8, 75, 0.2, 6.7], life: 180 },
  { id: 'coconut-milk', name: 'coconut milk', cat: F, unit: 'can', units: ['can', 'ml', 'cup'], n: [230, 2.3, 5.5, 23.8, 2.2], life: 720 },
  // meat
  { id: 'ground-beef', name: 'ground beef', cat: M, aliases: ['beef mince', 'minced beef'], animal: 'beef', n: [250, 26, 0, 15], storage: 'fridge', life: 2, subs: ['ground-turkey', 'lentils'] },
  { id: 'beef-steak', name: 'steak', plural: 'steaks', cat: M, aliases: ['sirloin', 'ribeye', 'flank steak'], animal: 'beef', unit: 'piece', units: ['piece', 'g', 'oz', 'lb'], n: [271, 25, 0, 19], storage: 'fridge', life: 3 },
  { id: 'beef-stew', name: 'stewing beef', cat: M, aliases: ['chuck', 'braising steak'], animal: 'beef', n: [216, 20, 0, 15], storage: 'fridge', life: 3 },
  { id: 'pork-chop', name: 'pork chop', plural: 'pork chops', cat: M, animal: 'pork', unit: 'piece', units: ['piece', 'g', 'oz', 'lb'], n: [231, 25, 0, 14], storage: 'fridge', life: 3, subs: ['chicken-thigh'] },
  { id: 'pork-shoulder', name: 'pork shoulder', cat: M, aliases: ['pork butt'], animal: 'pork', n: [269, 20, 0, 21], storage: 'fridge', life: 3 },
  { id: 'bacon', name: 'bacon', cat: M, animal: 'pork', unit: 'slice', units: ['slice', 'g', 'oz'], n: [541, 37, 1.4, 42], storage: 'fridge', life: 7, subs: ['pancetta'] },
  { id: 'pancetta', name: 'pancetta', cat: M, animal: 'pork', n: [458, 12, 0, 45], storage: 'fridge', life: 14, subs: ['bacon'] },
  { id: 'sausage', name: 'sausage', plural: 'sausages', cat: M, aliases: ['pork sausage', 'Italian sausage'], animal: 'pork', unit: 'piece', units: ['piece', 'g', 'lb'], n: [301, 12, 2, 27], storage: 'fridge', life: 3 },
  { id: 'chorizo', name: 'chorizo', cat: M, animal: 'pork', n: [455, 24, 2, 38], storage: 'fridge', life: 21 },
  { id: 'lamb', name: 'lamb', cat: M, aliases: ['lamb shoulder', 'lamb chops', 'ground lamb'], animal: 'lamb', n: [294, 25, 0, 21], storage: 'fridge', life: 3 },
  // poultry
  { id: 'chicken-breast', name: 'chicken breast', plural: 'chicken breasts', cat: P, animal: 'poultry', unit: 'piece', units: ['piece', 'g', 'oz', 'lb'], n: [165, 31, 0, 3.6], storage: 'fridge', life: 2, subs: ['chicken-thigh', 'tofu'] },
  { id: 'chicken-thigh', name: 'chicken thigh', plural: 'chicken thighs', cat: P, animal: 'poultry', unit: 'piece', units: ['piece', 'g', 'oz', 'lb'], n: [209, 26, 0, 11], storage: 'fridge', life: 2, subs: ['chicken-breast'] },
  { id: 'whole-chicken', name: 'whole chicken', cat: P, animal: 'poultry', unit: 'whole', units: ['whole', 'kg', 'lb'], n: [239, 27, 0, 14], storage: 'fridge', life: 2 },
  { id: 'chicken-wings', name: 'chicken wings', cat: P, animal: 'poultry', n: [203, 30, 0, 8], storage: 'fridge', life: 2 },
  { id: 'ground-turkey', name: 'ground turkey', cat: P, aliases: ['turkey mince'], animal: 'poultry', n: [149, 19, 0, 8], storage: 'fridge', life: 2, subs: ['ground-beef', 'ground-chicken'] },
  { id: 'ground-chicken', name: 'ground chicken', cat: P, animal: 'poultry', n: [143, 17, 0, 8], storage: 'fridge', life: 2, subs: ['ground-turkey'] },
  { id: 'duck-breast', name: 'duck breast', cat: P, animal: 'poultry', unit: 'piece', units: ['piece', 'g', 'oz'], n: [337, 19, 0, 28], storage: 'fridge', life: 2 },
  // seafood
  { id: 'salmon', name: 'salmon', cat: S, aliases: ['salmon fillet'], animal: 'fish', unit: 'fillet', units: ['fillet', 'g', 'oz', 'lb'], n: [208, 20, 0, 13], storage: 'fridge', life: 2, subs: ['trout', 'cod'] },
  { id: 'cod', name: 'cod', cat: S, aliases: ['white fish', 'haddock', 'pollock'], animal: 'fish', unit: 'fillet', units: ['fillet', 'g', 'oz', 'lb'], n: [82, 18, 0, 0.7], storage: 'fridge', life: 2, subs: ['salmon'] },
  { id: 'trout', name: 'trout', cat: S, animal: 'fish', unit: 'fillet', units: ['fillet', 'g', 'oz'], n: [148, 21, 0, 6.6], storage: 'fridge', life: 2, subs: ['salmon'] },
  { id: 'tuna-canned', name: 'canned tuna', cat: S, aliases: ['tinned tuna'], animal: 'fish', unit: 'can', units: ['can', 'g'], n: [116, 26, 0, 1], life: 720 },
  { id: 'shrimp', name: 'shrimp', cat: S, aliases: ['prawns'], animal: 'shellfish', n: [99, 24, 0.2, 0.3], storage: 'freezer', life: 180 },
  { id: 'mussels', name: 'mussels', cat: S, animal: 'shellfish', n: [86, 12, 3.7, 2.2], storage: 'fridge', life: 1 },
  { id: 'squid', name: 'squid', cat: S, aliases: ['calamari'], animal: 'shellfish', n: [92, 16, 3, 1.4], storage: 'freezer', life: 180 },
  { id: 'anchovies', name: 'anchovies', cat: S, animal: 'fish', unit: 'fillet', units: ['fillet', 'tin', 'g'], n: [210, 29, 0, 10], storage: 'fridge', life: 180 },
  // eggs & dairy
  { id: 'egg', name: 'egg', plural: 'eggs', cat: D, animal: 'egg', unit: 'piece', units: ['piece', 'large'], n: [143, 12.6, 0.7, 9.5], storage: 'fridge', life: 28 },
  { id: 'butter', name: 'butter', cat: D, animal: 'dairy', unit: 'tbsp', units: ['tbsp', 'g', 'oz', 'stick'], n: [717, 0.9, 0.1, 81], storage: 'fridge', life: 60, subs: ['olive-oil', 'coconut-oil'] },
  { id: 'milk', name: 'milk', cat: D, animal: 'dairy', unit: 'ml', units: ['ml', 'cup', 'l'], n: [61, 3.2, 4.8, 3.3], storage: 'fridge', life: 7, subs: ['oat-milk', 'coconut-milk'] },
  { id: 'oat-milk', name: 'oat milk', cat: D, unit: 'ml', units: ['ml', 'cup', 'l'], n: [43, 1, 6.7, 1.5], storage: 'fridge', life: 7, subs: ['milk'] },
  { id: 'heavy-cream', name: 'heavy cream', cat: D, aliases: ['double cream', 'whipping cream'], animal: 'dairy', unit: 'ml', units: ['ml', 'cup', 'tbsp'], n: [340, 2.1, 2.8, 36], storage: 'fridge', life: 10, subs: ['coconut-milk'] },
  { id: 'yogurt', name: 'plain yogurt', cat: D, aliases: ['Greek yogurt', 'natural yogurt'], animal: 'dairy', unit: 'cup', units: ['cup', 'g', 'tbsp'], n: [59, 10, 3.6, 0.4], storage: 'fridge', life: 14, subs: ['sour-cream'] },
  { id: 'sour-cream', name: 'sour cream', cat: D, aliases: ['crème fraîche'], animal: 'dairy', unit: 'tbsp', units: ['tbsp', 'cup', 'g'], n: [198, 2.4, 4.6, 19], storage: 'fridge', life: 14, subs: ['yogurt'] },
  { id: 'parmesan', name: 'Parmesan', cat: D, aliases: ['parmigiano', 'pecorino', 'grana padano'], animal: 'dairy', unit: 'g', units: ['g', 'cup', 'tbsp', 'oz'], n: [431, 38, 4.1, 29], storage: 'fridge', life: 60 },
  { id: 'cheddar', name: 'cheddar', cat: D, animal: 'dairy', n: [403, 25, 1.3, 33], storage: 'fridge', life: 30, subs: ['gruyere'] },
  { id: 'mozzarella', name: 'mozzarella', cat: D, animal: 'dairy', unit: 'ball', units: ['ball', 'g', 'cup'], n: [280, 28, 3.1, 17], storage: 'fridge', life: 7 },
  { id: 'feta', name: 'feta', cat: D, animal: 'dairy', n: [264, 14, 4.1, 21], storage: 'fridge', life: 30, subs: ['goat-cheese'] },
  { id: 'goat-cheese', name: 'goat cheese', cat: D, aliases: ['chèvre'], animal: 'dairy', n: [364, 22, 0.1, 30], storage: 'fridge', life: 21, subs: ['feta'] },
  { id: 'gruyere', name: 'Gruyère', cat: D, aliases: ['Swiss cheese', 'Emmental'], animal: 'dairy', n: [413, 30, 0.4, 32], storage: 'fridge', life: 30, subs: ['cheddar'] },
  { id: 'cream-cheese', name: 'cream cheese', cat: D, animal: 'dairy', n: [342, 6, 4, 34], storage: 'fridge', life: 14 },
  { id: 'ricotta', name: 'ricotta', cat: D, animal: 'dairy', unit: 'cup', units: ['cup', 'g'], n: [174, 11, 3, 13], storage: 'fridge', life: 7 },
  { id: 'tofu', name: 'tofu', cat: D, aliases: ['firm tofu', 'bean curd'], allergens: ['soy'], unit: 'block', units: ['block', 'g'], n: [76, 8, 1.9, 4.8, 0.3], storage: 'fridge', life: 7, subs: ['tempeh', 'chicken-breast'] },
  { id: 'tempeh', name: 'tempeh', cat: D, allergens: ['soy'], n: [193, 19, 9, 11], storage: 'fridge', life: 10, subs: ['tofu'] },
  // grains & pasta
  { id: 'rice', name: 'rice', cat: G, aliases: ['long grain rice', 'jasmine rice', 'basmati'], unit: 'cup', units: ['cup', 'g'], n: [365, 7, 80, 0.7, 1.3], life: 720 },
  { id: 'arborio-rice', name: 'arborio rice', cat: G, aliases: ['risotto rice'], unit: 'cup', units: ['cup', 'g'], n: [350, 6.5, 78, 0.6, 1], life: 720, subs: ['rice'] },
  { id: 'brown-rice', name: 'brown rice', cat: G, unit: 'cup', units: ['cup', 'g'], n: [370, 7.9, 77, 2.9, 3.5], life: 365, subs: ['rice', 'quinoa'] },
  { id: 'quinoa', name: 'quinoa', cat: G, unit: 'cup', units: ['cup', 'g'], n: [368, 14, 64, 6, 7], life: 720, subs: ['brown-rice', 'couscous'] },
  { id: 'pasta', name: 'pasta', cat: G, aliases: ['spaghetti', 'penne', 'rigatoni', 'fusilli'], gluten: true, n: [371, 13, 75, 1.5, 3.2], life: 720, subs: ['gf-pasta'] },
  { id: 'gf-pasta', name: 'gluten-free pasta', cat: G, n: [357, 7, 78, 1.5, 2], life: 720, subs: ['pasta'] },
  { id: 'egg-noodles', name: 'egg noodles', cat: G, animal: 'egg', gluten: true, n: [384, 14, 71, 4.4, 3.3], life: 365, subs: ['rice-noodles'] },
  { id: 'rice-noodles', name: 'rice noodles', cat: G, aliases: ['vermicelli', 'pad thai noodles'], n: [364, 6, 80, 0.6, 1.6], life: 720, subs: ['egg-noodles'] },
  { id: 'couscous', name: 'couscous', cat: G, gluten: true, unit: 'cup', units: ['cup', 'g'], n: [376, 13, 77, 0.6, 5], life: 720, subs: ['quinoa'] },
  { id: 'bulgur', name: 'bulgur', cat: G, gluten: true, unit: 'cup', units: ['cup', 'g'], n: [342, 12, 76, 1.3, 18], life: 720, subs: ['quinoa'] },
  { id: 'oats', name: 'rolled oats', cat: G, aliases: ['oatmeal', 'porridge oats'], unit: 'cup', units: ['cup', 'g'], n: [389, 17, 66, 7, 10.6], life: 365 },
  { id: 'bread', name: 'bread', cat: G, aliases: ['sourdough', 'baguette', 'sandwich bread'], gluten: true, unit: 'slice', units: ['slice', 'loaf', 'g'], n: [265, 9, 49, 3.2, 2.7], storage: 'counter', life: 4 },
  { id: 'tortilla', name: 'tortilla', plural: 'tortillas', cat: G, aliases: ['flour tortilla', 'corn tortilla', 'wrap'], gluten: true, unit: 'piece', units: UNIT_SETS.count, n: [312, 8, 51, 8, 3], storage: 'counter', life: 14 },
  { id: 'pita', name: 'pita', plural: 'pitas', cat: G, aliases: ['flatbread', 'naan'], gluten: true, unit: 'piece', units: UNIT_SETS.count, n: [275, 9, 55, 1.2, 2.2], storage: 'counter', life: 5 },
  { id: 'breadcrumbs', name: 'breadcrumbs', cat: G, aliases: ['panko'], gluten: true, unit: 'cup', units: ['cup', 'g'], n: [395, 13, 72, 5.3, 4.5], life: 180 },
  { id: 'polenta', name: 'polenta', cat: G, aliases: ['cornmeal'], unit: 'cup', units: ['cup', 'g'], n: [362, 8, 77, 1.7, 7], life: 365 },
  // legumes
  { id: 'chickpeas', name: 'chickpeas', cat: L, aliases: ['garbanzo beans'], unit: 'can', units: ['can', 'cup', 'g'], n: [164, 8.9, 27, 2.6, 7.6], life: 720, subs: ['white-beans'] },
  { id: 'black-beans', name: 'black beans', cat: L, unit: 'can', units: ['can', 'cup', 'g'], n: [132, 8.9, 24, 0.5, 8.7], life: 720, subs: ['kidney-beans', 'pinto-beans'] },
  { id: 'kidney-beans', name: 'kidney beans', cat: L, unit: 'can', units: ['can', 'cup', 'g'], n: [127, 8.7, 22.8, 0.5, 6.4], life: 720, subs: ['black-beans'] },
  { id: 'pinto-beans', name: 'pinto beans', cat: L, unit: 'can', units: ['can', 'cup', 'g'], n: [143, 9, 26, 0.7, 9], life: 720, subs: ['black-beans'] },
  { id: 'white-beans', name: 'white beans', cat: L, aliases: ['cannellini', 'navy beans', 'butter beans'], unit: 'can', units: ['can', 'cup', 'g'], n: [139, 9.7, 25, 0.4, 6.3], life: 720, subs: ['chickpeas'] },
  { id: 'lentils', name: 'lentils', cat: L, aliases: ['red lentils', 'green lentils', 'brown lentils'], unit: 'cup', units: ['cup', 'g'], n: [116, 9, 20, 0.4, 7.9], life: 720, subs: ['chickpeas'] },
  { id: 'edamame', name: 'edamame', cat: L, allergens: ['soy'], unit: 'cup', units: ['cup', 'g'], n: [121, 11, 9.9, 5.2, 5.2], storage: 'freezer', life: 365 },
  // nuts & seeds
  { id: 'almonds', name: 'almonds', cat: N, allergens: ['tree nuts'], unit: 'cup', units: ['cup', 'g', 'handful'], n: [579, 21, 22, 50, 12.5], life: 180, subs: ['cashews', 'sunflower-seeds'] },
  { id: 'walnuts', name: 'walnuts', cat: N, allergens: ['tree nuts'], unit: 'cup', units: ['cup', 'g', 'handful'], n: [654, 15, 14, 65, 6.7], life: 180, subs: ['pecans'] },
  { id: 'pecans', name: 'pecans', cat: N, allergens: ['tree nuts'], unit: 'cup', units: ['cup', 'g'], n: [691, 9, 14, 72, 9.6], life: 180, subs: ['walnuts'] },
  { id: 'cashews', name: 'cashews', cat: N, allergens: ['tree nuts'], unit: 'cup', units: ['cup', 'g', 'handful'], n: [553, 18, 30, 44, 3.3], life: 180, subs: ['almonds'] },
  { id: 'peanuts', name: 'peanuts', cat: N, allergens: ['peanuts'], unit: 'cup', units: ['cup', 'g', 'handful'], n: [567, 26, 16, 49, 8.5], life: 180, subs: ['sunflower-seeds'] },
  { id: 'peanut-butter', name: 'peanut butter', cat: N, allergens: ['peanuts'], unit: 'tbsp', units: ['tbsp', 'g'], n: [588, 25, 20, 50, 6], life: 180, subs: ['tahini', 'almond-butter'] },
  { id: 'almond-butter', name: 'almond butter', cat: N, allergens: ['tree nuts'], unit: 'tbsp', units: ['tbsp', 'g'], n: [614, 21, 19, 56, 10], life: 180, subs: ['peanut-butter'] },
  { id: 'pine-nuts', name: 'pine nuts', cat: N, allergens: ['tree nuts'], unit: 'tbsp', units: ['tbsp', 'g'], n: [673, 14, 13, 68, 3.7], storage: 'fridge', life: 90, subs: ['sunflower-seeds'] },
  { id: 'sesame-seeds', name: 'sesame seeds', cat: N, allergens: ['sesame'], unit: 'tbsp', units: ['tbsp', 'tsp', 'g'], n: [573, 18, 23, 50, 12], life: 180 },
  { id: 'tahini', name: 'tahini', cat: N, allergens: ['sesame'], unit: 'tbsp', units: ['tbsp', 'g'], n: [595, 17, 21, 54, 9], storage: 'fridge', life: 180 },
  { id: 'sunflower-seeds', name: 'sunflower seeds', cat: N, unit: 'tbsp', units: ['tbsp', 'cup', 'g'], n: [584, 21, 20, 51, 8.6], life: 180 },
  { id: 'chia-seeds', name: 'chia seeds', cat: N, unit: 'tbsp', units: ['tbsp', 'g'], n: [486, 17, 42, 31, 34], life: 365 },
  { id: 'pumpkin-seeds', name: 'pumpkin seeds', cat: N, aliases: ['pepitas'], unit: 'tbsp', units: ['tbsp', 'cup', 'g'], n: [559, 30, 11, 49, 6], life: 180 },
  // herbs & spices
  { id: 'salt', name: 'salt', cat: H, aliases: ['kosher salt', 'sea salt', 'flaky salt'], unit: 'tsp', units: UNIT_SETS.spice, n: [0, 0, 0, 0], life: 3650 },
  { id: 'black-pepper', name: 'black pepper', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [251, 10, 64, 3.3, 25], life: 1095 },
  { id: 'cumin', name: 'cumin', cat: H, aliases: ['ground cumin', 'cumin seeds'], unit: 'tsp', units: UNIT_SETS.spice, n: [375, 18, 44, 22, 10.5], life: 730 },
  { id: 'coriander-seed', name: 'ground coriander', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [298, 12, 55, 18, 42], life: 730 },
  { id: 'paprika', name: 'paprika', cat: H, aliases: ['smoked paprika', 'sweet paprika'], unit: 'tsp', units: UNIT_SETS.spice, n: [282, 14, 54, 13, 35], life: 730 },
  { id: 'chili-flakes', name: 'chili flakes', cat: H, aliases: ['red pepper flakes', 'crushed red pepper'], unit: 'tsp', units: UNIT_SETS.spice, n: [318, 12, 57, 17, 27], life: 730, subs: ['chili', 'cayenne'] },
  { id: 'cayenne', name: 'cayenne', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [318, 12, 57, 17, 27], life: 730, subs: ['chili-flakes'] },
  { id: 'chili-powder', name: 'chili powder', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [282, 13, 50, 14, 35], life: 730 },
  { id: 'turmeric', name: 'turmeric', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [312, 10, 67, 3.3, 22], life: 730 },
  { id: 'curry-powder', name: 'curry powder', cat: H, aliases: ['garam masala'], unit: 'tsp', units: UNIT_SETS.spice, n: [325, 14, 56, 14, 53], life: 730 },
  { id: 'cinnamon', name: 'cinnamon', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [247, 4, 81, 1.2, 53], life: 730 },
  { id: 'nutmeg', name: 'nutmeg', cat: H, unit: 'pinch', units: UNIT_SETS.spice, n: [525, 6, 49, 36, 21], life: 1095 },
  { id: 'oregano', name: 'dried oregano', cat: H, unit: 'tsp', units: UNIT_SETS.spice, n: [265, 9, 69, 4.3, 42.5], life: 730, subs: ['thyme'] },
  { id: 'thyme', name: 'thyme', cat: H, aliases: ['fresh thyme', 'dried thyme'], unit: 'sprig', units: UNIT_SETS.herb, n: [101, 5.6, 24, 1.7, 14], storage: 'fridge', life: 10, subs: ['oregano', 'rosemary'] },
  { id: 'rosemary', name: 'rosemary', cat: H, unit: 'sprig', units: UNIT_SETS.herb, n: [131, 3.3, 20, 5.9, 14], storage: 'fridge', life: 14, subs: ['thyme'] },
  { id: 'bay-leaf', name: 'bay leaf', plural: 'bay leaves', cat: H, unit: 'leaf', units: ['leaf', 'piece'], n: [313, 7.6, 75, 8.4, 26], life: 730 },
  { id: 'basil', name: 'basil', cat: H, aliases: ['fresh basil', 'Thai basil'], unit: 'handful', units: UNIT_SETS.herb, n: [23, 3.2, 2.7, 0.6, 1.6], storage: 'counter', life: 4 },
  { id: 'parsley', name: 'parsley', cat: H, aliases: ['flat-leaf parsley'], unit: 'handful', units: UNIT_SETS.herb, n: [36, 3, 6.3, 0.8, 3.3], storage: 'fridge', life: 7, subs: ['cilantro'] },
  { id: 'cilantro', name: 'cilantro', cat: H, aliases: ['coriander leaves', 'fresh coriander'], unit: 'handful', units: UNIT_SETS.herb, n: [23, 2.1, 3.7, 0.5, 2.8], storage: 'fridge', life: 5, subs: ['parsley'] },
  { id: 'mint', name: 'mint', cat: H, unit: 'handful', units: UNIT_SETS.herb, n: [70, 3.8, 15, 0.9, 8], storage: 'fridge', life: 5 },
  { id: 'dill', name: 'dill', cat: H, unit: 'handful', units: UNIT_SETS.herb, n: [43, 3.5, 7, 1.1, 2.1], storage: 'fridge', life: 5 },
  { id: 'chives', name: 'chives', cat: H, unit: 'tbsp', units: UNIT_SETS.herb, n: [30, 3.3, 4.4, 0.7, 2.5], storage: 'fridge', life: 7, subs: ['spring-onion'] },
  { id: 'lemongrass', name: 'lemongrass', cat: H, unit: 'stalk', units: ['stalk', 'tbsp'], n: [99, 1.8, 25, 0.5], storage: 'fridge', life: 14 },
  { id: 'vanilla', name: 'vanilla extract', cat: H, alcohol: true, unit: 'tsp', units: ['tsp', 'tbsp'], n: [288, 0.1, 12.7, 0.1], life: 1095 },
  // oils & condiments
  { id: 'olive-oil', name: 'olive oil', cat: O, aliases: ['extra virgin olive oil'], unit: 'tbsp', units: ['tbsp', 'ml', 'cup'], n: [884, 0, 0, 100], life: 365, subs: ['vegetable-oil'] },
  { id: 'vegetable-oil', name: 'neutral oil', cat: O, aliases: ['canola oil', 'sunflower oil', 'vegetable oil'], unit: 'tbsp', units: ['tbsp', 'ml', 'cup'], n: [884, 0, 0, 100], life: 365, subs: ['olive-oil'] },
  { id: 'sesame-oil', name: 'sesame oil', cat: O, allergens: ['sesame'], unit: 'tsp', units: ['tsp', 'tbsp', 'ml'], n: [884, 0, 0, 100], life: 365 },
  { id: 'coconut-oil', name: 'coconut oil', cat: O, unit: 'tbsp', units: ['tbsp', 'g'], n: [862, 0, 0, 100], life: 730, subs: ['butter'] },
  { id: 'soy-sauce', name: 'soy sauce', cat: O, aliases: ['shoyu'], allergens: ['soy'], gluten: true, unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [53, 8, 4.9, 0.6], storage: 'fridge', life: 365, subs: ['tamari'] },
  { id: 'tamari', name: 'tamari', cat: O, allergens: ['soy'], unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [60, 10, 5.6, 0.1], storage: 'fridge', life: 365, subs: ['soy-sauce'] },
  { id: 'fish-sauce', name: 'fish sauce', cat: O, animal: 'fish', unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [35, 5, 3.6, 0], life: 730, subs: ['soy-sauce'] },
  { id: 'oyster-sauce', name: 'oyster sauce', cat: O, animal: 'shellfish', allergens: ['soy'], gluten: true, unit: 'tbsp', units: ['tbsp', 'tsp'], n: [51, 1.4, 11, 0], storage: 'fridge', life: 365 },
  { id: 'vinegar', name: 'vinegar', cat: O, aliases: ['white wine vinegar', 'red wine vinegar', 'apple cider vinegar'], unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [21, 0, 0.9, 0], life: 1095, subs: ['lemon'] },
  { id: 'rice-vinegar', name: 'rice vinegar', cat: O, unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [18, 0, 0.4, 0], life: 1095, subs: ['vinegar'] },
  { id: 'balsamic', name: 'balsamic vinegar', cat: O, unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [88, 0.5, 17, 0], life: 1095 },
  { id: 'dijon', name: 'Dijon mustard', cat: O, aliases: ['mustard'], unit: 'tsp', units: ['tsp', 'tbsp'], n: [66, 4.4, 5.8, 3.3], storage: 'fridge', life: 365 },
  { id: 'mayonnaise', name: 'mayonnaise', cat: O, animal: 'egg', unit: 'tbsp', units: ['tbsp', 'cup'], n: [680, 1, 0.6, 75], storage: 'fridge', life: 60, subs: ['yogurt'] },
  { id: 'ketchup', name: 'ketchup', cat: O, unit: 'tbsp', units: ['tbsp', 'cup'], n: [101, 1, 27, 0.1], storage: 'fridge', life: 180 },
  { id: 'hot-sauce', name: 'hot sauce', cat: O, aliases: ['sriracha', 'tabasco'], unit: 'tsp', units: ['tsp', 'tbsp'], n: [11, 0.5, 1.8, 0.4], storage: 'fridge', life: 365 },
  { id: 'miso', name: 'miso', cat: O, allergens: ['soy'], unit: 'tbsp', units: ['tbsp', 'g'], n: [199, 12, 26, 6], storage: 'fridge', life: 365 },
  { id: 'gochujang', name: 'gochujang', cat: O, allergens: ['soy'], gluten: true, unit: 'tbsp', units: ['tbsp', 'g'], n: [190, 5, 40, 1.5], storage: 'fridge', life: 365 },
  { id: 'harissa', name: 'harissa', cat: O, unit: 'tbsp', units: ['tbsp', 'g'], n: [90, 3, 12, 4], storage: 'fridge', life: 90, subs: ['chili-flakes'] },
  { id: 'curry-paste', name: 'curry paste', cat: O, aliases: ['Thai red curry paste', 'green curry paste'], animal: 'shellfish', unit: 'tbsp', units: ['tbsp', 'g'], n: [110, 3, 15, 4], storage: 'fridge', life: 180 },
  { id: 'honey', name: 'honey', cat: O, animal: 'honey', unit: 'tbsp', units: ['tbsp', 'tsp', 'g'], n: [304, 0.3, 82, 0], life: 3650, subs: ['maple-syrup'] },
  { id: 'maple-syrup', name: 'maple syrup', cat: O, unit: 'tbsp', units: ['tbsp', 'tsp', 'ml'], n: [260, 0, 67, 0.1], storage: 'fridge', life: 365, subs: ['honey'] },
  { id: 'stock', name: 'stock', cat: O, aliases: ['broth', 'chicken stock', 'vegetable stock', 'bouillon'], unit: 'ml', units: ['ml', 'cup', 'l'], n: [7, 0.6, 0.8, 0.2], life: 365 },
  { id: 'capers', name: 'capers', cat: O, unit: 'tbsp', units: ['tbsp', 'tsp'], n: [23, 2.4, 4.9, 0.9, 3.2], storage: 'fridge', life: 365 },
  { id: 'white-wine', name: 'white wine', cat: O, alcohol: true, unit: 'ml', units: ['ml', 'cup', 'splash'], n: [82, 0.1, 2.6, 0], storage: 'fridge', life: 5, subs: ['stock'] },
  { id: 'peanut-oil', name: 'peanut oil', cat: O, allergens: ['peanuts'], unit: 'tbsp', units: ['tbsp', 'ml'], n: [884, 0, 0, 100], life: 365, subs: ['vegetable-oil'] },
  // baking
  { id: 'flour', name: 'all-purpose flour', cat: B, aliases: ['plain flour', 'wheat flour'], gluten: true, unit: 'cup', units: ['cup', 'g', 'tbsp'], n: [364, 10, 76, 1, 2.7], life: 365, subs: ['gf-flour'] },
  { id: 'gf-flour', name: 'gluten-free flour blend', cat: B, unit: 'cup', units: ['cup', 'g', 'tbsp'], n: [360, 4, 80, 1.5, 3], life: 365, subs: ['flour'] },
  { id: 'almond-flour', name: 'almond flour', cat: B, allergens: ['tree nuts'], unit: 'cup', units: ['cup', 'g'], n: [571, 21, 21, 50, 10], storage: 'fridge', life: 180 },
  { id: 'cornstarch', name: 'cornstarch', cat: B, aliases: ['cornflour'], unit: 'tbsp', units: ['tbsp', 'tsp', 'g'], n: [381, 0.3, 91, 0.1, 0.9], life: 730 },
  { id: 'sugar', name: 'sugar', cat: B, aliases: ['granulated sugar', 'caster sugar'], unit: 'cup', units: ['cup', 'g', 'tbsp', 'tsp'], n: [387, 0, 100, 0], life: 3650, subs: ['honey', 'maple-syrup'] },
  { id: 'brown-sugar', name: 'brown sugar', cat: B, unit: 'cup', units: ['cup', 'g', 'tbsp'], n: [380, 0, 98, 0], life: 3650, subs: ['sugar'] },
  { id: 'baking-powder', name: 'baking powder', cat: B, unit: 'tsp', units: ['tsp', 'tbsp'], n: [53, 0, 28, 0], life: 365 },
  { id: 'baking-soda', name: 'baking soda', cat: B, aliases: ['bicarbonate of soda'], unit: 'tsp', units: ['tsp', 'tbsp'], n: [0, 0, 0, 0], life: 730 },
  { id: 'yeast', name: 'yeast', cat: B, aliases: ['instant yeast', 'active dry yeast'], unit: 'tsp', units: ['tsp', 'packet', 'g'], n: [325, 40, 41, 7.6, 27], storage: 'fridge', life: 365 },
  { id: 'cocoa', name: 'cocoa powder', cat: B, unit: 'tbsp', units: ['tbsp', 'cup', 'g'], n: [228, 20, 58, 14, 33], life: 730 },
  { id: 'dark-chocolate', name: 'dark chocolate', cat: B, unit: 'g', units: ['g', 'oz', 'bar'], n: [546, 4.9, 61, 31, 7], life: 365 },
  { id: 'puff-pastry', name: 'puff pastry', cat: B, animal: 'dairy', gluten: true, unit: 'sheet', units: ['sheet', 'g'], n: [558, 7.4, 45, 38, 1.5], storage: 'freezer', life: 180 },
];

export const INGREDIENTS: Ingredient[] = defs.map(build);

const byId = new Map(INGREDIENTS.map((i) => [i.id, i]));
const byName = new Map<string, Ingredient>();
for (const i of INGREDIENTS) {
  byName.set(i.name.toLowerCase(), i);
  byName.set(i.plural.toLowerCase(), i);
  for (const a of i.aliases) byName.set(a.toLowerCase(), i);
}

export function getIngredient(id: string): Ingredient | undefined {
  return byId.get(id);
}

/** Best-effort match of free text ("2 large yellow onions, diced") to a preset. */
export function matchIngredient(text: string): Ingredient | undefined {
  const t = text.toLowerCase().replace(/[^a-z\s-]/g, ' ').replace(/\s+/g, ' ').trim();
  if (!t) return undefined;
  const direct = byName.get(t);
  if (direct) return direct;
  let best: Ingredient | undefined;
  let bestLen = 0;
  for (const [name, ing] of byName) {
    if (name.length > bestLen && new RegExp(`(^|\\s)${name.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}(s|es)?(\\s|$)`).test(t)) {
      best = ing;
      bestLen = name.length;
    }
  }
  return best;
}

export function searchIngredients(query: string, limit = 40): Ingredient[] {
  const q = query.trim().toLowerCase();
  if (!q) return INGREDIENTS.slice(0, limit);
  const scored = INGREDIENTS.map((i) => {
    const hay = [i.name, i.plural, ...i.aliases].map((s) => s.toLowerCase());
    let score = 0;
    for (const h of hay) {
      if (h === q) score = Math.max(score, 3);
      else if (h.startsWith(q)) score = Math.max(score, 2);
      else if (h.includes(q)) score = Math.max(score, 1);
    }
    return { i, score };
  });
  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score || a.i.name.localeCompare(b.i.name))
    .slice(0, limit)
    .map((s) => s.i);
}
