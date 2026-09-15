import { Router } from 'express';
import { z } from 'zod';
import {
  AuthoredRecipeSchema,
  GenerateRequestSchema,
  RecipeContentSchema,
  getIngredient,
  type Recipe,
  type RecipeContent,
  type RecipeSummary,
} from '@foodi/shared';
import { allergenWarnings, postProcess, type createAiService } from '../ai/service.js';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { getProfile } from './profile.js';

export interface RecipeRow {
  id: string;
  user_id: string;
  source: 'ai' | 'user';
  visibility: 'private' | 'public';
  title: string;
  prompt: string;
  requested_ingredient_ids: string;
  provider: string;
  model: string;
  content: string;
  favorite: number;
  created_at: string;
  updated_at: string;
}

export function toRecipe(row: RecipeRow, warnings: string[]): Recipe {
  return {
    id: row.id,
    createdAt: row.created_at,
    favorite: Boolean(row.favorite),
    prompt: row.prompt,
    requestedIngredientIds: JSON.parse(row.requested_ingredient_ids) as string[],
    provider: row.provider,
    model: row.model,
    warnings,
    content: JSON.parse(row.content) as RecipeContent,
  };
}

export function toSummary(row: RecipeRow, warnings: string[]): RecipeSummary {
  const c = JSON.parse(row.content) as RecipeContent;
  return {
    id: row.id,
    createdAt: row.created_at,
    favorite: Boolean(row.favorite),
    title: c.title,
    summary: c.summary,
    mealType: c.mealType,
    totalMinutes: c.totalMinutes,
    difficulty: c.difficulty,
    servings: c.servings,
    warnings,
  };
}

/** Fill in the optional fields an authored recipe may leave blank. */
function completeAuthored(input: z.infer<typeof AuthoredRecipeSchema>): RecipeContent {
  return RecipeContentSchema.parse({
    cuisine: null,
    dietLabels: [],
    tags: [],
    allergens: [],
    equipment: [],
    techniques: [],
    substitutions: [],
    makeAhead: null,
    storage: null,
    nutritionPerServing: null,
    ...input,
    summary: input.summary || 'A recipe I make.',
    activeMinutes: Math.max(1, input.activeMinutes || Math.round(input.totalMinutes / 2)),
  });
}

export function recipeRoutes(db: Db, ai: ReturnType<typeof createAiService>) {
  const r = Router();
  r.use(requireAuth);

  /** A recipe you own, or one someone has shared publicly. */
  function loadVisible(id: string, userId: string): RecipeRow {
    const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', id);
    if (!row) throw notFound('That recipe no longer exists.');
    if (row.user_id !== userId && row.visibility !== 'public') throw forbidden('That recipe is private.');
    return row;
  }
  function loadOwned(id: string, userId: string): RecipeRow {
    const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ? AND user_id = ?', id, userId);
    if (!row) throw notFound('That recipe no longer exists.');
    return row;
  }

  r.get('/', (req, res) => {
    const profile = getProfile(db, req.user!.id);
    const rows = all<RecipeRow>(db, 'SELECT * FROM recipes WHERE user_id = ? ORDER BY favorite DESC, created_at DESC LIMIT 200', req.user!.id);
    res.json({ recipes: rows.map((row) => toSummary(row, allergenWarnings(JSON.parse(row.content), profile))) });
  });

  r.post('/generate', async (req, res, next) => {
    try {
      const body = parse(GenerateRequestSchema, req.body);
      const userId = req.user!.id;
      const profile = getProfile(db, userId);
      if (!profile) throw badRequest('Finish onboarding before generating recipes.');
      if (!body.prompt && body.ingredientIds.length === 0 && !body.basedOnRecipeId) throw badRequest('Tell us what you feel like, or pick some ingredients.');

      const requested = body.ingredientIds.map((id) => getIngredient(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
      const basedOn = body.basedOnRecipeId ? (JSON.parse(loadVisible(body.basedOnRecipeId, userId).content) as RecipeContent) : null;

      const result = await ai.generate(userId, {
        profile,
        prompt: body.prompt || (requested.length ? `Something good with what I picked.` : 'Adjust this recipe.'),
        requestedIngredients: requested,
        servings: body.servings ?? basedOn?.servings ?? profile.householdSize,
        timeBudgetMinutes: body.timeBudgetMinutes ?? profile.timeBudgetMinutes,
        mealType: body.mealType ?? null,
        basedOn,
      });

      const id = newId('rcp');
      const t = now();
      run(
        db,
        `INSERT INTO recipes (id, user_id, source, visibility, title, prompt, requested_ingredient_ids, provider, model, content, favorite, created_at, updated_at)
         VALUES (?, ?, 'ai', 'private', ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
        id,
        userId,
        result.content.title,
        body.prompt,
        JSON.stringify(requested.map((i) => i.id)),
        result.vendor,
        result.model,
        JSON.stringify(result.content),
        t,
        t,
      );
      ai.linkRecipeId(result.generationId, id);
      const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', id)!;
      res.status(201).json({ recipe: toRecipe(row, allergenWarnings(result.content, profile)) });
    } catch (e) {
      next(e);
    }
  });

  /** Author your own recipe. */
  r.post('/', (req, res) => {
    const userId = req.user!.id;
    const content = postProcess(completeAuthored(parse(AuthoredRecipeSchema, req.body)), getProfile(db, userId) ?? ({} as never));
    const id = newId('rcp');
    const t = now();
    run(
      db,
      `INSERT INTO recipes (id, user_id, source, visibility, title, content, favorite, created_at, updated_at) VALUES (?, ?, 'user', 'private', ?, ?, 0, ?, ?)`,
      id,
      userId,
      content.title,
      JSON.stringify(content),
      t,
      t,
    );
    const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', id)!;
    res.status(201).json({ recipe: toRecipe(row, allergenWarnings(content, getProfile(db, userId))) });
  });

  r.get('/:id', (req, res) => {
    const userId = req.user!.id;
    const row = loadVisible(req.params['id']!, userId);
    const author = one<{ handle: string; display_name: string | null }>(db, 'SELECT handle, display_name FROM users WHERE id = ?', row.user_id);
    res.json({
      recipe: toRecipe(row, allergenWarnings(JSON.parse(row.content), getProfile(db, userId))),
      isMine: row.user_id === userId,
      source: row.source,
      visibility: row.visibility,
      author: author ? { handle: author.handle, displayName: author.display_name ?? author.handle } : null,
    });
  });

  r.put('/:id', (req, res) => {
    const userId = req.user!.id;
    const row = loadOwned(req.params['id']!, userId);
    if (row.source !== 'user') throw forbidden('Generated recipes can be tweaked, not edited by hand. Use “Adjust”.');
    const content = postProcess(completeAuthored(parse(AuthoredRecipeSchema, req.body)), getProfile(db, userId) ?? ({} as never));
    run(db, 'UPDATE recipes SET title = ?, content = ?, updated_at = ? WHERE id = ?', content.title, JSON.stringify(content), now(), row.id);
    const fresh = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', row.id)!;
    res.json({ recipe: toRecipe(fresh, allergenWarnings(content, getProfile(db, userId))) });
  });

  r.post('/:id/favorite', (req, res) => {
    const row = loadOwned(req.params['id']!, req.user!.id);
    const favorite = parse(z.object({ favorite: z.boolean() }), req.body).favorite;
    run(db, 'UPDATE recipes SET favorite = ?, updated_at = ? WHERE id = ?', favorite ? 1 : 0, now(), row.id);
    res.json({ favorite });
  });

  /** Copy someone's shared recipe into your own collection. */
  r.post('/:id/save', (req, res) => {
    const userId = req.user!.id;
    const row = loadVisible(req.params['id']!, userId);
    if (row.user_id === userId) throw badRequest('That recipe is already yours.');
    const id = newId('rcp');
    const t = now();
    run(
      db,
      `INSERT INTO recipes (id, user_id, source, visibility, title, prompt, requested_ingredient_ids, provider, model, content, favorite, created_at, updated_at)
       VALUES (?, ?, ?, 'private', ?, '', '[]', ?, ?, ?, 0, ?, ?)`,
      id,
      userId,
      row.source,
      row.title,
      row.provider,
      row.model,
      row.content,
      t,
      t,
    );
    res.status(201).json({ id });
  });

  r.delete('/:id', (req, res) => {
    const row = loadOwned(req.params['id']!, req.user!.id);
    run(db, 'DELETE FROM recipes WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  return r;
}
