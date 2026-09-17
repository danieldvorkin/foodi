import { Router } from 'express';
import { z } from 'zod';
import {
  AuthoredRecipeSchema,
  EditRecipeSchema,
  GenerateRequestSchema,
  RecipeContentSchema,
  type Recipe,
  type RecipeContent,
  type RecipeSummary,
} from '@foodi/shared';
import { allergenWarnings, postProcess, type createAiService } from '../ai/service.js';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { getProfile } from './profile.js';
import { coverForRecipe, mediaForRecipe } from './media.js';
import type { Notifier } from '../services/notify.js';
import { canReadRecipe } from '../services/access.js';
import type { Jobs } from '../services/jobs.js';
import { runGeneration } from '../ai/generate-job.js';

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
  forked_from_id: string | null;
  forked_from_title: string | null;
  forked_from_handle: string | null;
  revision_notes: string;
}

export function parseContent(row: Pick<RecipeRow, 'content'>): RecipeContent {
  return RecipeContentSchema.parse(JSON.parse(row.content));
}

export function toRecipe(db: Db, row: RecipeRow, warnings: string[]): Recipe {
  return {
    id: row.id,
    createdAt: row.created_at,
    favorite: Boolean(row.favorite),
    prompt: row.prompt,
    requestedIngredientIds: JSON.parse(row.requested_ingredient_ids) as string[],
    provider: row.provider,
    model: row.model,
    warnings,
    media: mediaForRecipe(db, row.id),
    content: parseContent(row),
    adaptedFrom: lineage(db, row),
    revisionNotes: row.revision_notes ?? '',
    adaptationCount: one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM recipes WHERE forked_from_id = ?', row.id)!.n,
  };
}

/** Where an adapted recipe came from. The title/handle are snapshots, so this survives the original being deleted. */
export function lineage(db: Db, row: Pick<RecipeRow, 'forked_from_id' | 'forked_from_title' | 'forked_from_handle'>): Recipe['adaptedFrom'] {
  if (!row.forked_from_title) return null;
  const orig = row.forked_from_id ? one<{ visibility: string }>(db, 'SELECT visibility FROM recipes WHERE id = ?', row.forked_from_id) : undefined;
  return { id: orig ? row.forked_from_id : null, title: row.forked_from_title, handle: row.forked_from_handle ?? '', stillPublic: orig?.visibility === 'public' };
}

export function toSummary(db: Db, row: RecipeRow, warnings: string[]): RecipeSummary {
  const c = parseContent(row);
  return {
    id: row.id,
    createdAt: row.created_at,
    favorite: Boolean(row.favorite),
    emoji: c.emoji,
    cover: coverForRecipe(db, row.id),
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

export function recipeRoutes(db: Db, ai: ReturnType<typeof createAiService>, notifier: Notifier, jobs: Jobs) {
  const r = Router();
  r.use(requireAuth);

  /** A recipe you own, one someone has shared publicly, or one in a book you've bought. */
  function loadVisible(id: string, userId: string, role: string = 'consumer'): RecipeRow {
    const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', id);
    if (!row) throw notFound('That recipe no longer exists.');
    if (!canReadRecipe(db, id, { id: userId, role })) throw forbidden('That recipe is private.');
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
    res.json({ recipes: rows.map((row) => toSummary(db, row, allergenWarnings(parseContent(row), profile))) });
  });

  /**
   * Ask the AI for a recipe. By default this queues a job and returns 202 straight away; the
   * result arrives over the notification stream and as a notification. `?sync=1` keeps the old
   * blocking behaviour (used by tests and scripts).
   */
  r.post('/generate', async (req, res, next) => {
    try {
      const body = parse(GenerateRequestSchema, req.body);
      const userId = req.user!.id;
      if (!getProfile(db, userId)) throw badRequest('Finish onboarding before generating recipes.');
      if (!body.prompt && body.ingredientIds.length === 0 && !body.basedOnRecipeId && body.avoidTitles.length === 0) throw badRequest('Tell us what you feel like, or pick some ingredients.');
      // Fail fast on things a retry can't fix, before anything is queued.
      ai.preflight(userId, jobs.activeCount(userId));
      if (req.query['sync'] === '1') {
        const { recipe } = await runGeneration(db, ai, userId, body);
        res.status(201).json({ recipe });
        return;
      }
      if (jobs.activeCount(userId) >= 3) throw new HttpError(429, 'busy', 'Three recipes are already being written for you. Give them a minute.');
      res.status(202).json({ job: jobs.enqueue('generate', userId, body) });
    } catch (e) {
      next(e);
    }
  });

  r.get('/jobs', (req, res) => res.json({ jobs: jobs.listFor(req.user!.id, req.query['active'] === '1') }));
  r.get('/jobs/:id', (req, res) => {
    const job = jobs.get(req.params['id']!);
    const row = jobs.getRow(req.params['id']!);
    if (!job || !row || row.user_id !== req.user!.id) throw notFound('No such job.');
    res.json({ job });
  });
  r.post('/jobs/:id/cancel', (req, res) => {
    if (!jobs.cancel(req.params['id']!, req.user!.id)) throw badRequest('Only queued jobs can be cancelled.');
    res.json({ job: jobs.get(req.params['id']!) });
  });
  r.post('/jobs/:id/retry', (req, res) => {
    const row = jobs.getRow(req.params['id']!);
    if (!row || row.user_id !== req.user!.id) throw notFound('No such job.');
    ai.preflight(req.user!.id, jobs.activeCount(req.user!.id));
    if (!jobs.retry(row.id, req.user!.id)) throw badRequest('Only failed jobs can be retried.');
    res.json({ job: jobs.get(row.id) });
  });

  /** Ask for a generated cover photo for one of your recipes (the vendor must be able to). */
  r.post('/:id/photo', (req, res) => {
    const userId = req.user!.id;
    const row = loadOwned(req.params['id']!, userId);
    if (!ai.capabilities(userId).images) throw new HttpError(409, 'no_image_support', 'The connected AI can’t generate images. Connect an OpenAI key to use this.');
    if (one(db, `SELECT 1 FROM jobs WHERE user_id = ? AND kind = 'image' AND result_recipe_id = ? AND status IN ('queued','running')`, userId, row.id)) throw new HttpError(409, 'busy', 'A photo is already being made for this recipe.');
    res.status(202).json({ job: jobs.enqueue('image', userId, { recipeId: row.id }, 2, row.id) });
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
    res.status(201).json({ recipe: toRecipe(db, row, allergenWarnings(content, getProfile(db, userId))) });
  });

  r.get('/:id', (req, res) => {
    const userId = req.user!.id;
    const row = loadVisible(req.params['id']!, userId, req.user!.role);
    const author = one<{ handle: string; display_name: string | null; avatar_emoji: string }>(db, 'SELECT handle, display_name, avatar_emoji FROM users WHERE id = ?', row.user_id);
    res.json({
      recipe: toRecipe(db, row, allergenWarnings(parseContent(row), getProfile(db, userId))),
      isMine: row.user_id === userId,
      source: row.source,
      visibility: row.visibility,
      author: author ? { handle: author.handle, displayName: author.display_name ?? author.handle, avatar: author.avatar_emoji } : null,
    });
  });

  r.put('/:id', (req, res) => {
    const userId = req.user!.id;
    const row = loadOwned(req.params['id']!, userId);
    if (row.source !== 'user') throw forbidden('Generated recipes can be tweaked, not edited by hand. Use “Adjust”.');
    const { revisionNotes, ...authored } = parse(EditRecipeSchema, req.body);
    const content = postProcess(completeAuthored(authored), getProfile(db, userId) ?? ({} as never));
    run(
      db,
      'UPDATE recipes SET title = ?, content = ?, revision_notes = ?, updated_at = ? WHERE id = ?',
      content.title,
      JSON.stringify(content),
      revisionNotes ?? row.revision_notes ?? '',
      now(),
      row.id,
    );
    const fresh = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', row.id)!;
    res.json({ recipe: toRecipe(db, fresh, allergenWarnings(content, getProfile(db, userId))) });
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
    notifier.send(row.user_id, 'save', { actorId: userId, recipeId: row.id });
    res.status(201).json({ id });
  });

  /**
   * Adapt a shared recipe: an editable copy that remembers its source. The copy starts private;
   * sharing it later credits the original on the post and the recipe page.
   */
  r.post('/:id/adapt', (req, res) => {
    const userId = req.user!.id;
    const row = loadVisible(req.params['id']!, userId);
    const author = one<{ handle: string }>(db, 'SELECT handle FROM users WHERE id = ?', row.user_id);
    const id = newId('rcp');
    const t = now();
    run(
      db,
      `INSERT INTO recipes (id, user_id, source, visibility, title, prompt, requested_ingredient_ids, provider, model, content, favorite, created_at, updated_at,
                            forked_from_id, forked_from_title, forked_from_handle, revision_notes)
       VALUES (?, ?, 'user', 'private', ?, '', '[]', '', '', ?, 0, ?, ?, ?, ?, ?, '')`,
      id,
      userId,
      row.title,
      row.content,
      t,
      t,
      row.id,
      row.title,
      author?.handle ?? '',
    );
    notifier.send(row.user_id, 'remix', { actorId: userId, recipeId: row.id });
    res.status(201).json({ id });
  });

  r.delete('/:id', (req, res) => {
    const row = loadOwned(req.params['id']!, req.user!.id);
    run(db, 'DELETE FROM recipes WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  return r;
}
