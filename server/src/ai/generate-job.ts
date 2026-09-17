import { GenerateRequestSchema, getIngredient, type Recipe } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { getProfile } from '../routes/profile.js';
import { parseContent, toRecipe, type RecipeRow } from '../routes/recipes.js';
import { canReadRecipe } from '../services/access.js';
import { JobError, type JobRow, type Jobs } from '../services/jobs.js';
import type { Notifier } from '../services/notify.js';
import { allergenWarnings, type createAiService } from './service.js';
import { AiError } from './types.js';

type Ai = ReturnType<typeof createAiService>;

/** Codes that a retry won't fix: the person has to do something. */
const PERMANENT = new Set(['credential_rejected', 'credential_unusable', 'no_credential', 'vendor_unavailable', 'quota']);

/**
 * Turn a GenerateRequest into a saved recipe. Used both by the job worker and by the synchronous
 * `?sync=1` path so the two can never drift.
 */
export async function runGeneration(db: Db, ai: Ai, userId: string, request: unknown): Promise<{ recipe: Recipe; row: RecipeRow }> {
  const body = GenerateRequestSchema.parse(request);
  const profile = getProfile(db, userId);
  if (!profile) throw new HttpError(400, 'no_profile', 'Finish onboarding before generating recipes.');
  const requested = body.ingredientIds.map((id) => getIngredient(id)).filter((i): i is NonNullable<typeof i> => Boolean(i));
  let basedOn = null;
  if (body.basedOnRecipeId) {
    const src = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ?', body.basedOnRecipeId);
    if (!src || !canReadRecipe(db, src.id, { id: userId, role: 'consumer' })) throw new HttpError(404, 'not_found', 'That recipe no longer exists.');
    basedOn = parseContent(src);
  }
  const result = await ai.generate(userId, {
    profile,
    prompt: body.prompt || (requested.length ? 'Something good with what I picked.' : basedOn ? 'Adjust this recipe.' : 'Surprise me with something different.'),
    requestedIngredients: requested,
    servings: body.servings ?? basedOn?.servings ?? profile.householdSize,
    timeBudgetMinutes: body.timeBudgetMinutes ?? profile.timeBudgetMinutes,
    mealType: body.mealType ?? null,
    basedOn,
    avoidTitles: body.avoidTitles,
    seed: body.seed ?? null,
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
  return { recipe: toRecipe(db, row, allergenWarnings(result.content, profile)), row };
}

/** The job-queue handler: same work, plus classification of failures and a notification at the end. */
export function generateJobHandler(db: Db, ai: Ai, notifier: Notifier, jobs: Jobs) {
  return async (job: JobRow) => {
    let payload: unknown;
    try {
      payload = JSON.parse(job.payload);
    } catch {
      throw new JobError('bad_payload', 'The request could not be read.', false);
    }
    try {
      const { recipe } = await runGeneration(db, ai, job.user_id, payload);
      notifier.send(job.user_id, 'recipe', { recipeId: recipe.id, message: `Your recipe is ready: “${recipe.content.title}”` });
      // The photo is a separate, slower step; only when the person wants it and the vendor can.
      const wants = one<{ auto_photos: number }>(db, 'SELECT auto_photos FROM users WHERE id = ?', job.user_id)?.auto_photos;
      if (wants && ai.capabilities(job.user_id).images) jobs.enqueue('image', job.user_id, { recipeId: recipe.id }, 2, recipe.id);
      return { recipeId: recipe.id };
    } catch (err) {
      if (err instanceof HttpError) {
        const code = err.code.replace(/^ai_/, '');
        const transient = code === 'rate_limited' || code === 'bad_output' || code === 'network' || code === 'vendor_error' || err.status >= 500;
        throw new JobError(code, err.message, !PERMANENT.has(code) && transient);
      }
      if (err instanceof AiError) throw new JobError(err.code, err.message, !PERMANENT.has(err.code));
      throw err;
    }
  };
}
