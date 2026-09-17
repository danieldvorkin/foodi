import { getIngredient, INGREDIENTS, matchIngredient, type Ingredient, type Profile, type RecipeContent, type RecipeIngredient, type Step } from '@foodi/shared';
import type { CredentialPayload } from '../auth/providers/types.js';
import { encodePng } from '../lib/png.js';
import type { AiClient, GenerateInput, GenerateOutput, ImageInput, ImageOutput, VisionOutput } from './types.js';

/**
 * A deterministic, offline recipe writer. It is not clever, but it respects the same hard
 * rules as the real prompt (allergies, diet, dislikes, requested ingredients, time budget),
 * which makes it useful for local development, demos and tests.
 */
export function createMockClient(): AiClient {
  return {
    vendor: 'mock',
    model: 'mock-chef-1',
    async generate(input: GenerateInput, _credential: CredentialPayload): Promise<GenerateOutput> {
      await new Promise((r) => setTimeout(r, 400 + (hash(input.prompt + (input.seed ?? '')) % 600)));
      return { content: compose(input), model: 'mock-chef-1', usage: { inputTokens: 900, outputTokens: 1400 } };
    },
    /** A warm, plate-like gradient seeded by the prompt — recognisably "a photo", never the same twice. */
    async generateImage(input: ImageInput, _credential: CredentialPayload): Promise<ImageOutput> {
      const h = hash(input.prompt);
      const base: [number, number, number] = [170 + (h % 60), 110 + ((h >> 3) % 70), 60 + ((h >> 6) % 60)];
      const size = 256;
      const png = encodePng(size, size, (x, y) => {
        const dx = x - size / 2;
        const dy = y - size / 2;
        const d = Math.sqrt(dx * dx + dy * dy) / (size / 2);
        const plate = d < 0.9 ? 1 : 0.35;
        const food = d < 0.62 ? 1 : 0.55;
        return [Math.min(255, base[0] * food * plate + (1 - plate) * 235), Math.min(255, base[1] * food * plate + (1 - plate) * 230), Math.min(255, base[2] * food * plate + (1 - plate) * 220)].map(Math.round) as [number, number, number];
      });
      return { png, model: 'mock-camera-1' };
    },
    /** Says yes unless the recipe title asks it not to ("reject-me" is the test hook). */
    async describeImage(_png: Buffer, recipe: { title: string; keyIngredients: string[]; library?: boolean }, _credential: CredentialPayload): Promise<VisionOutput> {
      // "reject-me" in the title: a different dish; "not-food": not food at all.
      const reject = /reject-me/i.test(recipe.title);
      const notFood = /not-food/i.test(recipe.title);
      return {
        verdict: { isFood: !notFood, matchesDish: !reject && !notFood, hasProblems: false, note: notFood ? 'Not food.' : reject ? 'Looks like a different dish.' : 'Plausible photo of the dish.' },
        model: 'mock-eyes-1',
        usage: { inputTokens: 600, outputTokens: 40 },
      };
    },
  };
}

type Style = 'skillet' | 'traybake' | 'soup' | 'bowl' | 'pasta' | 'stir-fry' | 'salad' | 'curry';

function pickStyle(prompt: string, seed: number): Style {
  const p = prompt.toLowerCase();
  const table: [RegExp, Style][] = [
    [/pasta|spaghetti|noodle|penne|mac\b|macaroni|lasagn|carbonara|ragu|bolognese/, 'pasta'],
    [/soup|broth|stew|chowder/, 'soup'],
    [/curry|coconut|dal|masala/, 'curry'],
    [/stir.?fry|wok|asian|thai|chinese|korean/, 'stir-fry'],
    [/salad|fresh|light|cold/, 'salad'],
    [/bowl|grain|quinoa|rice bowl/, 'bowl'],
    [/roast|tray|sheet.?pan|oven|bake/, 'traybake'],
    [/taco|burrito|fajita|quesadilla|wrap|skillet|pan\b|fry|saut/, 'skillet'],
  ];
  for (const [re, s] of table) if (re.test(p)) return s;
  const styles: Style[] = ['skillet', 'traybake', 'bowl', 'pasta', 'stir-fry', 'curry'];
  return styles[seed % styles.length]!;
}

function allowed(profile: Profile, i: Ingredient): boolean {
  const a = profile.allergies.map((s) => s.toLowerCase());
  if (i.allergens.some((x) => a.includes(x.toLowerCase()))) return false;
  if (a.includes('nuts') && i.allergens.includes('tree nuts')) return false;
  const d = profile.dislikes.map((s) => s.toLowerCase());
  if (d.some((x) => i.name.toLowerCase().includes(x) || i.aliases.some((al) => al.toLowerCase().includes(x)))) return false;
  const s = i.suitableFor;
  switch (profile.diet) {
    case 'vegan':
      return s.vegan;
    case 'vegetarian':
      return s.vegetarian;
    case 'pescatarian':
      return s.pescatarian;
    case 'keto':
      return s.ketoFriendly || i.category === 'herbs & spices' || i.category === 'oils & condiments';
    case 'halal':
      return s.halal;
    case 'kosher':
      return s.kosher;
    case 'gluten-free':
      return s.glutenFree;
    default:
      return true;
  }
}

function firstAllowed(profile: Profile, ids: string[], fallback: string | null = null): Ingredient | null {
  for (const id of ids) {
    const i = getIngredient(id);
    if (i && allowed(profile, i)) return i;
  }
  return fallback ? getIngredient(fallback) ?? null : null;
}

function compose(input: GenerateInput): RecipeContent {
  const { profile } = input;
  const seed = hash(input.prompt + input.requestedIngredients.map((i) => i.id).join(',') + (input.seed ?? ''));
  const keyworded = pickStyle(input.prompt, seed);
  const styles: Style[] = ['skillet', 'traybake', 'soup', 'bowl', 'pasta', 'stir-fry', 'salad', 'curry'];
  // A re-roll must land somewhere new: rotate away from the styles already shown.
  const style: Style = input.avoidTitles.length ? styles[(styles.indexOf(keyworded) + 1 + (seed % (styles.length - 1))) % styles.length]! : keyworded;
  const metric = profile.units === 'metric';
  const servings = input.servings;
  const mult = servings / 2;
  const q = (n: number) => String(Math.round(n * mult * 2) / 2).replace(/\.0$/, '');

  // Ingredients the person named in the request count as requested too ("mac n cheese" → pasta, cheddar).
  const mentioned = mentionedIngredients(input.prompt).filter((i) => !input.requestedIngredients.some((r) => r.id === i.id));
  const requested = [...input.requestedIngredients, ...mentioned].filter((i) => allowed(profile, i));
  const protein =
    requested.find((i) => ['meat', 'poultry', 'seafood', 'legumes'].includes(i.category) || ['tofu', 'tempeh', 'egg'].includes(i.id)) ??
    (profile.diet === 'vegan'
      ? firstAllowed(profile, ['chickpeas', 'tofu', 'lentils'])
      : profile.diet === 'vegetarian'
        ? firstAllowed(profile, ['egg', 'chickpeas', 'tofu', 'feta'])
        : profile.diet === 'pescatarian'
          ? firstAllowed(profile, ['salmon', 'shrimp', 'cod'])
          : firstAllowed(profile, style === 'curry' ? ['chicken-thigh', 'chickpeas'] : ['chicken-thigh', 'ground-beef', 'salmon', 'chickpeas']));
  const veg = requested.filter((i) => i.category === 'vegetables' && !['onion', 'garlic', 'shallot', 'ginger'].includes(i.id));
  const vegPick = veg.length ? veg.slice(0, 3) : [firstAllowed(profile, style === 'stir-fry' ? ['broccoli', 'bell-pepper', 'bok-choy'] : ['zucchini', 'bell-pepper', 'spinach', 'broccoli', 'cherry-tomato'])].filter(Boolean) as Ingredient[];
  const starch =
    requested.find((i) => i.category === 'grains & pasta') ??
    (style === 'pasta'
      ? firstAllowed(profile, ['pasta', 'gf-pasta'])
      : style === 'bowl' || style === 'curry' || style === 'stir-fry'
        ? firstAllowed(profile, ['rice', 'quinoa'])
        : style === 'traybake'
          ? firstAllowed(profile, ['potato', 'sweet-potato'])
          : null);
  const aromatic = firstAllowed(profile, ['garlic']);
  const onion = firstAllowed(profile, style === 'stir-fry' ? ['spring-onion', 'onion'] : ['onion', 'shallot']);
  const fat = firstAllowed(profile, style === 'stir-fry' ? ['vegetable-oil', 'olive-oil'] : ['olive-oil', 'vegetable-oil']);
  const acid = firstAllowed(profile, style === 'stir-fry' || style === 'curry' ? ['lime', 'lemon'] : ['lemon', 'vinegar']);
  const herb = firstAllowed(profile, style === 'curry' || style === 'stir-fry' ? ['cilantro', 'basil', 'parsley'] : ['parsley', 'basil', 'chives']);
  const spice = firstAllowed(profile, style === 'curry' ? ['curry-powder', 'cumin'] : style === 'traybake' ? ['paprika', 'oregano'] : ['chili-flakes', 'black-pepper']);
  const extra = style === 'curry' ? firstAllowed(profile, ['coconut-milk']) : style === 'pasta' ? firstAllowed(profile, ['parmesan', 'cherry-tomato']) : style === 'stir-fry' ? firstAllowed(profile, ['soy-sauce', 'tamari']) : style === 'soup' ? firstAllowed(profile, ['stock']) : style === 'salad' ? firstAllowed(profile, ['feta', 'avocado', 'cucumber']) : null;
  const heatOk = profile.spice !== 'mild';

  const lines: RecipeIngredient[] = [];
  const idx = new Map<string, number>();
  const add = (i: Ingredient | null, quantity: string | null, unit: string | null, preparation: string | null = null, note: string | null = null, group: string | null = null, optional = false) => {
    if (!i || idx.has(i.id)) return;
    idx.set(i.id, lines.length);
    lines.push({ item: i.name, quantity, unit, preparation, note, group, optional, ingredientId: i.id });
  };
  const ref = (...items: (Ingredient | null)[]) => items.filter((i): i is Ingredient => Boolean(i) && idx.has(i!.id)).map((i) => idx.get(i.id)!);

  add(fat, q(1.5), 'tbsp');
  add(onion, q(1), onion?.defaultUnit ?? 'piece', 'sliced');
  add(aromatic, q(2), 'clove', 'minced');
  if (protein) {
    const byCount = protein.units.includes('piece') || protein.units.includes('fillet');
    const byCan = protein.category === 'legumes' && protein.units.includes('can');
    add(
      protein,
      byCan ? q(1) : byCount ? q(2) : q(metric ? 300 : 0.7),
      byCan ? 'can' : byCount ? protein.defaultUnit : metric ? 'g' : 'lb',
      protein.category === 'meat' || protein.category === 'poultry' ? 'cut into bite-size pieces' : protein.id === 'egg' ? 'beaten' : protein.id === 'tofu' ? 'pressed and cubed' : null,
    );
  }
  for (const v of vegPick) add(v, v.defaultUnit === 'g' ? q(metric ? 200 : 7) : q(1), v.defaultUnit === 'g' ? (metric ? 'g' : 'oz') : v.defaultUnit, 'chopped');
  if (starch) add(starch, q(metric ? 180 : 0.4), metric ? 'g' : 'lb', null, style === 'pasta' ? 'any short shape' : null);
  if (extra) {
    if (extra.id === 'coconut-milk') add(extra, '1', 'can');
    else if (extra.id === 'stock') add(extra, q(metric ? 750 : 3), metric ? 'ml' : 'cup');
    else if (extra.id === 'parmesan') add(extra, q(metric ? 30 : 1), metric ? 'g' : 'oz', 'grated');
    else if (extra.category === 'oils & condiments') add(extra, q(2), 'tbsp');
    else if (extra.defaultUnit === 'g') add(extra, q(metric ? 100 : 3.5), metric ? 'g' : 'oz');
    else add(extra, q(1), extra.defaultUnit);
  }
  add(spice, heatOk || spice?.id !== 'chili-flakes' ? '1' : '1/4', 'tsp');
  add(acid, '1/2', acid?.defaultUnit ?? 'piece', acid?.id === 'lemon' || acid?.id === 'lime' ? 'juiced' : null);
  add(herb, 'a handful', null, 'roughly chopped', null, null, true);
  add(getIngredient('salt') ?? null, null, null, null, 'to taste');
  add(getIngredient('black-pepper') ?? null, null, null, null, 'to taste');

  const proteinName = protein?.name ?? 'the vegetables';
  const vegNames = vegPick.map((v) => v.plural).join(' and ') || 'the vegetables';
  const steps: Step[] = [];
  const step = (title: string, text: string, timerSeconds: number | null, refs: number[], temperature: string | null = null, tip: string | null = null) =>
    steps.push({ title, text, timerSeconds, ingredientRefs: refs, temperature, tip });

  step('Get everything ready', `Slice the ${onion?.name ?? 'onion'}, mince the ${aromatic?.name ?? 'garlic'} and chop the ${vegNames}. ${protein ? `Pat the ${proteinName} dry and season it with salt and pepper.` : ''}`.trim(), null, ref(onion, aromatic, ...vegPick, protein), null, profile.skill === 'beginner' ? 'Doing all the chopping first means nothing burns while you look for a knife.' : null);

  if (style === 'traybake') {
    step('Heat the oven', `Heat the oven and line a large tray.`, null, [], metric ? 'Oven 200°C fan' : 'Oven 425°F', null);
    step('Toss and spread out', `Toss the ${vegNames}${starch ? `, ${starch.plural}` : ''}${protein ? ` and ${proteinName}` : ''} with the ${fat?.name ?? 'oil'}, ${spice?.name ?? 'spice'}, salt and pepper. Spread in one layer with space between pieces.`, null, ref(...vegPick, starch, protein, fat, spice), null, 'Crowding the tray steams instead of roasts. Use two trays if needed.');
    step('Roast', `Roast until the edges are dark and the ${proteinName} is cooked through, turning once halfway.`, 25 * 60, [], null, null);
    step('Finish', `Squeeze over the ${acid?.name ?? 'lemon'} and scatter the ${herb?.name ?? 'herbs'}. Taste for salt.`, null, ref(acid, herb), null, null);
  } else if (style === 'pasta') {
    step('Start the pasta water', `Bring a large pot of well-salted water to the boil.`, null, [], 'High heat', null);
    step('Build the base', `Warm the ${fat?.name ?? 'oil'} in a wide pan and soften the ${onion?.name ?? 'onion'} with a pinch of salt, then add the ${aromatic?.name ?? 'garlic'} for the last minute.`, 5 * 60, ref(fat, onion, aromatic), 'Medium heat', null);
    if (protein) step(`Cook the ${proteinName}`, `Add the ${proteinName} and cook, stirring now and then, until browned.`, 6 * 60, ref(protein), 'Medium-high heat', null);
    step('Cook the pasta', `Drop the ${starch?.name ?? 'pasta'} into the boiling water and cook until just short of tender. Save a mug of the cooking water before draining.`, 9 * 60, ref(starch), null, 'The starchy water is what turns everything into a sauce.');
    step('Add the vegetables', `Add the ${vegNames} and ${spice?.name ?? 'chili'} to the pan and cook until softened.`, 4 * 60, ref(...vegPick, spice), null, null);
    step('Bring it together', `Tip the drained pasta into the pan with a splash of the cooking water${extra ? ` and the ${extra.name}` : ''}. Toss over the heat until glossy. Finish with ${acid?.name ?? 'lemon'} and ${herb?.name ?? 'herbs'}.`, null, ref(starch, extra, acid, herb), null, null);
  } else if (style === 'soup') {
    step('Soften the base', `Warm the ${fat?.name ?? 'oil'} in a large pot and cook the ${onion?.name ?? 'onion'} with a pinch of salt until translucent. Add the ${aromatic?.name ?? 'garlic'} and ${spice?.name ?? 'spices'} and stir for a minute.`, 6 * 60, ref(fat, onion, aromatic, spice), 'Medium heat', null);
    step('Add the rest', `Add the ${vegNames}${protein ? ` and ${proteinName}` : ''}${starch ? ` and ${starch.name}` : ''}, then pour in the ${extra?.name ?? 'stock'}.`, null, ref(...vegPick, protein, starch, extra), null, null);
    step('Simmer', `Bring to a boil, then lower to a gentle simmer with the lid ajar until everything is tender.`, 20 * 60, [], 'Low heat', null);
    step('Season and serve', `Add the ${acid?.name ?? 'lemon'}, taste for salt and pepper, and top with ${herb?.name ?? 'herbs'}.`, null, ref(acid, herb), null, null);
  } else if (style === 'salad') {
    if (protein) step(`Cook the ${proteinName}`, `Cook the ${proteinName} in the ${fat?.name ?? 'oil'} until done, then let it rest while you make the rest.`, 8 * 60, ref(protein, fat), 'Medium-high heat', null);
    step('Make the dressing', `Whisk the ${acid?.name ?? 'lemon'} juice with a pinch of salt, the ${aromatic?.name ?? 'garlic'} and a generous pour of ${fat?.name ?? 'oil'}.`, null, ref(acid, aromatic, fat), null, null);
    step('Assemble', `Toss the ${vegNames} with the dressing${extra ? `, add the ${extra.name}` : ''}${protein ? ` and top with the ${proteinName}` : ''}. Scatter the ${herb?.name ?? 'herbs'} and ${spice?.name ?? 'pepper'}.`, null, ref(...vegPick, extra, protein, herb, spice), null, null);
  } else if (style === 'curry') {
    step('Fry the aromatics', `Warm the ${fat?.name ?? 'oil'} in a deep pan. Cook the ${onion?.name ?? 'onion'} until golden, then add the ${aromatic?.name ?? 'garlic'} and ${spice?.name ?? 'spices'} and fry until fragrant.`, 7 * 60, ref(fat, onion, aromatic, spice), 'Medium heat', 'Fragrant means about 30 seconds — spices burn fast.');
    if (protein) step(`Add the ${proteinName}`, `Add the ${proteinName} and stir to coat in the spices.`, 3 * 60, ref(protein), null, null);
    step('Simmer', `Add the ${vegNames} and the ${extra?.name ?? 'coconut milk'}. Simmer gently until the sauce thickens and everything is tender.`, 15 * 60, ref(...vegPick, extra), 'Low heat', null);
    if (starch) step(`Cook the ${starch.name}`, `Meanwhile, cook the ${starch.name} following the packet timing.`, 12 * 60, ref(starch), null, null);
    step('Finish', `Stir in the ${acid?.name ?? 'lime'} juice and taste for salt. Top with ${herb?.name ?? 'herbs'}.`, null, ref(acid, herb), null, null);
  } else if (style === 'stir-fry') {
    if (starch) step(`Start the ${starch.name}`, `Get the ${starch.name} cooking first; a stir-fry comes together fast at the end.`, 12 * 60, ref(starch), null, null);
    step('Get the pan very hot', `Heat a wok or wide pan until a drop of water skitters. Add the ${fat?.name ?? 'oil'}.`, null, ref(fat), 'High heat', null);
    if (protein) step(`Sear the ${proteinName}`, `Add the ${proteinName} in one layer. Leave it alone for a minute, then toss until just cooked. Move to a plate.`, 3 * 60, ref(protein), 'High heat', null);
    step('Stir-fry the vegetables', `Add the ${aromatic?.name ?? 'garlic'}, ${onion?.name ?? 'spring onion'} and ${vegNames}. Keep everything moving until crisp-tender.`, 3 * 60, ref(aromatic, onion, ...vegPick), 'High heat', null);
    step('Sauce and serve', `Return the ${proteinName}, add the ${extra?.name ?? 'soy sauce'}, ${spice?.name ?? 'chili'} and ${acid?.name ?? 'lime'} juice. Toss for 30 seconds and serve over the ${starch?.name ?? 'rice'} with ${herb?.name ?? 'herbs'}.`, null, ref(protein, extra, spice, acid, starch, herb), null, null);
  } else {
    // skillet / bowl
    if (starch) step(`Cook the ${starch.name}`, `Start the ${starch.name} first so it is ready when the pan is.`, 15 * 60, ref(starch), null, null);
    step('Brown', `Warm the ${fat?.name ?? 'oil'} in a large skillet. ${protein ? `Add the ${proteinName} and cook until browned all over.` : `Add the ${vegNames} and cook until they take some color.`}`, 6 * 60, ref(fat, protein ?? vegPick[0] ?? null), 'Medium-high heat', 'Don’t stir too often; color is flavor.');
    step('Add aromatics', `Add the ${onion?.name ?? 'onion'} and ${aromatic?.name ?? 'garlic'} with the ${spice?.name ?? 'spice'} and cook until soft and fragrant.`, 4 * 60, ref(onion, aromatic, spice), 'Medium heat', null);
    if (protein) step('Add the vegetables', `Add the ${vegNames} and cook until tender but still bright.`, 5 * 60, ref(...vegPick), null, null);
    step('Finish', `Squeeze in the ${acid?.name ?? 'lemon'}, season with salt and pepper, and scatter the ${herb?.name ?? 'herbs'}.${starch ? ` Serve over the ${starch.name}.` : ''}`, null, ref(acid, herb, starch), null, null);
  }

  const timed = steps.reduce((a, s) => a + (s.timerSeconds ?? 0), 0);
  const total = Math.min(input.timeBudgetMinutes, Math.max(15, Math.round(timed / 60) + 10));
  const allergens = [...new Set(lines.flatMap((l) => getIngredient(l.ingredientId ?? '')?.allergens ?? []))];
  const dietLabels: RecipeContent['dietLabels'] = [];
  const all = lines.map((l) => getIngredient(l.ingredientId ?? '')).filter(Boolean) as Ingredient[];
  if (all.every((i) => i.suitableFor.vegan)) dietLabels.push('vegan');
  if (all.every((i) => i.suitableFor.vegetarian)) dietLabels.push('vegetarian');
  if (all.every((i) => i.suitableFor.glutenFree)) dietLabels.push('gluten-free');
  if (all.every((i) => i.suitableFor.dairyFree)) dietLabels.push('dairy-free');
  if (protein && (protein.nutritionPer100g.protein > 15)) dietLabels.push('high-protein');

  const names: Record<Style, string> = {
    skillet: `${cap(proteinName)} skillet with ${vegNames}`,
    traybake: `Roasted ${proteinName} traybake`,
    soup: `${cap(vegPick[0]?.name ?? 'vegetable')} and ${proteinName} soup`,
    bowl: `${cap(starch?.name ?? 'grain')} bowl with ${proteinName}`,
    pasta: `${cap(starch?.name ?? 'pasta')} with ${proteinName} and ${vegPick[0]?.plural ?? 'greens'}`,
    'stir-fry': `${cap(proteinName)} and ${vegPick[0]?.name ?? 'vegetable'} stir-fry`,
    salad: `Warm ${proteinName} salad`,
    curry: `${cap(proteinName)} and ${vegPick[0]?.name ?? 'vegetable'} curry`,
  };

  const kcal = Math.round(all.reduce((a, i) => a + i.nutritionPer100g.kcal, 0) / Math.max(1, all.length) * 3.2);
  const protG = Math.round(all.reduce((a, i) => a + i.nutritionPer100g.protein, 0) / Math.max(1, all.length) * 3);

  const emojiByStyle: Record<Style, string> = { skillet: '🍳', traybake: '🥘', soup: '🍲', bowl: '🥣', pasta: '🍝', 'stir-fry': '🥡', salad: '🥗', curry: '🍛' };
  const emoji = protein?.id === 'salmon' && style === 'traybake' ? '🐟' : protein?.category === 'poultry' && style === 'skillet' ? '🍗' : emojiByStyle[style];

  return {
    emoji,
    title: input.basedOn ? `${input.basedOn.title} (adjusted)` : names[style],
    summary: input.basedOn
      ? `A reworked version of the original to match: “${input.prompt}”.`
      : `A ${style === 'stir-fry' ? 'fast' : 'relaxed'} ${style} built around ${proteinName}${requested.length ? `, using the ingredients you picked` : ''}. Ready in about ${total} minutes.`,
    cuisine: style === 'curry' ? 'Indian-inspired' : style === 'stir-fry' ? 'East Asian-inspired' : style === 'pasta' ? 'Italian-inspired' : null,
    mealType: (input.mealType as RecipeContent['mealType'] | null) ?? 'dinner',
    servings,
    totalMinutes: total,
    activeMinutes: Math.max(10, Math.round(total * 0.6)),
    difficulty: steps.length > 6 ? 'medium' : 'easy',
    dietLabels,
    tags: [style, ...(profile.goals.slice(0, 2))],
    allergens,
    equipment: style === 'traybake' ? ['oven', 'baking tray'] : style === 'soup' ? ['large pot'] : style === 'stir-fry' ? ['wok or large pan'] : ['large pan'],
    techniques: style === 'traybake' ? ['roasting'] : style === 'stir-fry' ? ['stir-frying'] : ['sautéing'],
    ingredients: lines,
    steps,
    substitutions: [
      ...(protein?.substitutes[0] ? [{ ingredient: protein.name, swap: getIngredient(protein.substitutes[0])?.name ?? protein.substitutes[0], why: 'Same role, similar cook time.' }] : []),
      ...(herb ? [{ ingredient: herb.name, swap: 'any soft herb you have', why: null }] : []),
    ],
    makeAhead: style === 'soup' || style === 'curry' ? 'Tastes better the next day. Keep the herbs for serving.' : null,
    storage: 'Keeps 3 days in the fridge. Reheat gently with a splash of water.',
    nutritionPerServing: { calories: kcal, proteinGrams: protG, carbsGrams: Math.round(kcal * 0.12), fatGrams: Math.round(kcal * 0.04), fiberGrams: 6, sugarGrams: null, sodiumMg: null },
  };
}

const MENTION_SYNONYMS: Record<string, string> = { cheese: 'cheddar', cheesy: 'cheddar', mac: 'pasta', macaroni: 'pasta', noodles: 'egg-noodles', greens: 'kale', fish: 'cod', chicken: 'chicken-thigh', beef: 'ground-beef', steak: 'beef-steak', prawns: 'shrimp', beans: 'black-beans', eggs: 'egg', potatoes: 'potato', tomatoes: 'tomato', mushrooms: 'mushroom', peppers: 'bell-pepper', spuds: 'potato' };

function mentionedIngredients(prompt: string): Ingredient[] {
  const words = prompt.toLowerCase().replace(/[^a-z\s-]/g, ' ').split(/\s+/).filter(Boolean);
  const found = new Map<string, Ingredient>();
  for (let i = 0; i < words.length; i++) {
    for (const len of [3, 2, 1]) {
      const phrase = words.slice(i, i + len).join(' ');
      if (!phrase) continue;
      const syn = MENTION_SYNONYMS[phrase];
      const ing = syn ? getIngredient(syn) : matchIngredient(phrase);
      if (ing && !found.has(ing.id)) {
        found.set(ing.id, ing);
        break;
      }
    }
  }
  return [...found.values()].filter((i) => i.category !== 'herbs & spices' || ['basil', 'cilantro', 'mint', 'dill'].includes(i.id)).slice(0, 6);
}

function cap(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return Math.abs(h >>> 0);
}

export const MOCK_INGREDIENT_COUNT = INGREDIENTS.length;
