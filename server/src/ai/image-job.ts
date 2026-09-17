import { unlink, writeFile } from 'node:fs/promises';
import type { Db } from '../db/index.js';
import { one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';
import { imageSize, scrubImage } from '../lib/media-scrub.js';
import { now } from '../lib/time.js';
import type { MediaStore } from '../routes/media.js';
import { parseContent, type RecipeRow } from '../routes/recipes.js';
import { JobError, type JobRow } from '../services/jobs.js';
import type { Settings } from '../services/settings.js';
import { buildImagePrompt } from './prompt.js';
import type { createAiService } from './service.js';
import { AiError } from './types.js';

type Ai = ReturnType<typeof createAiService>;

/**
 * Make a cover photo for a recipe: ask the vendor for an image, have a vision model check it
 * is a photo of that dish with nothing odd in it, then save it through the normal media path.
 * A rejected image fails the attempt (the queue retries once with a stricter prompt); a second
 * rejection gives up and the recipe keeps its emoji.
 */
export function imageJobHandler(db: Db, ai: Ai, mediaStore: MediaStore, settings: Settings, log: Logger) {
  return async (job: JobRow) => {
    const { recipeId } = JSON.parse(job.payload) as { recipeId: string };
    const row = one<RecipeRow>(db, 'SELECT * FROM recipes WHERE id = ? AND user_id = ?', recipeId, job.user_id);
    if (!row) throw new JobError('gone', 'The recipe no longer exists.', false);
    if (one(db, `SELECT 1 FROM media WHERE recipe_id = ? AND kind = 'image' AND generated = 0`, recipeId)) throw new JobError('has_photo', 'The recipe already has a photo.', false);
    if (row.forked_from_id) throw new JobError('adapted', 'Photos aren’t generated for adapted copies.', false);

    const cred = ai.store.getCredential(job.user_id);
    if (!cred) throw new JobError('no_credential', 'No AI account is connected.', false);
    const client = ai.clients[cred.vendor];
    if (!client?.generateImage) throw new JobError('no_image_support', `${cred.vendor} can’t generate images.`, false);

    const content = parseContent(row);
    const strict = job.attempts > 1;
    const prompt = buildImagePrompt(content, strict);

    // 1. Generate.
    let png: Buffer;
    let imageModel: string;
    const t0 = Date.now();
    try {
      const out = await client.generateImage({ prompt, size: '1024x1024' }, cred.payload);
      png = out.png;
      imageModel = out.model;
      ai.recordAux(job.user_id, 'image', client.vendor, out.model, 'ok', Date.now() - t0, { recipeId });
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'unknown';
      ai.recordAux(job.user_id, 'image', client.vendor, client.model, 'failed', Date.now() - t0, { errorCode: code, recipeId });
      throw new JobError(code, (err as Error).message, !(code === 'credential_rejected' || code === 'credential_unusable'));
    }

    // 2. Validate, when the vendor can look at pictures.
    if (client.describeImage) {
      const t1 = Date.now();
      try {
        const seen = await client.describeImage(png, { title: content.title, keyIngredients: content.ingredients.slice(0, 6).map((i) => i.item) }, cred.payload);
        ai.recordAux(job.user_id, 'vision', client.vendor, seen.model, 'ok', Date.now() - t1, { inputTokens: seen.usage.inputTokens, outputTokens: seen.usage.outputTokens, recipeId });
        const v = seen.verdict;
        if (!v.isFood || !v.matchesDish || v.hasProblems) {
          log.info({ recipeId, attempt: job.attempts, verdict: v }, 'generated photo rejected');
          throw new JobError('image_rejected', `The photo didn’t pass the check: ${v.note || 'not a convincing picture of the dish'}.`, true);
        }
      } catch (err) {
        if (err instanceof JobError) throw err;
        const code = err instanceof AiError ? err.code : 'unknown';
        ai.recordAux(job.user_id, 'vision', client.vendor, client.model, 'failed', Date.now() - t1, { errorCode: code, recipeId });
        throw new JobError(code, (err as Error).message, true);
      }
    }

    // 3. Store it like an upload: scrubbed, quota-checked, as the cover.
    const bytes = scrubImage('image/png', png);
    const capMb = settings.get().maxUploadMbPerUser;
    const used = one<{ n: number }>(db, 'SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE owner_id = ?', job.user_id)!.n;
    if (capMb <= 0 || used + bytes.length > capMb * 1024 * 1024) throw new JobError('quota', `The photo would exceed your ${capMb} MB of upload space.`, false);
    const dims = imageSize('image/png', bytes);
    const id = newId('med');
    await writeFile(mediaStore.pathFor({ id, ext: 'png' }), bytes, { mode: 0o600 });
    // Any earlier generated cover is replaced; uploads keep their place.
    const stale = db.prepare(`SELECT id, ext FROM media WHERE recipe_id = ? AND generated = 1`).all(recipeId) as { id: string; ext: string }[];
    tx(db, () => {
      for (const old of stale) run(db, 'DELETE FROM media WHERE id = ?', old.id);
      run(db, 'UPDATE media SET position = position + 1 WHERE recipe_id = ?', recipeId);
      run(
        db,
        `INSERT INTO media (id, owner_id, kind, mime, ext, bytes, width, height, recipe_id, post_id, position, created_at, generated) VALUES (?, ?, 'image', 'image/png', 'png', ?, ?, ?, ?, NULL, 0, ?, 1)`,
        id,
        job.user_id,
        bytes.length,
        dims?.width ?? null,
        dims?.height ?? null,
        recipeId,
        now(),
      );
    });
    for (const old of stale) await unlink(mediaStore.pathFor(old)).catch(() => {});
    log.info({ recipeId, mediaId: id, model: imageModel, attempt: job.attempts }, 'generated photo saved');
    return { recipeId };
  };
}
