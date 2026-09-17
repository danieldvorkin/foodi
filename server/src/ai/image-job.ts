import type { Db } from '../db/index.js';
import { one } from '../db/index.js';
import type { Logger } from '../lib/logger.js';
import { PhotoError } from '../photos/types.js';
import type { PhotoService } from '../photos/service.js';
import { parseContent, type RecipeRow } from '../routes/recipes.js';
import { JobError, type JobRow } from '../services/jobs.js';
import { buildImagePrompt } from './prompt.js';
import type { createAiService } from './service.js';
import { AiError } from './types.js';

type Ai = ReturnType<typeof createAiService>;

export type ImageJobMode = 'auto' | 'generate' | 'source';
export interface ImageJobPayload {
  recipeId: string;
  /** `auto` generates when the vendor can and otherwise finds a library photo. */
  mode?: ImageJobMode;
}

/**
 * Give a recipe a cover photo. Two ways in:
 *  - generate: ask the vendor for an image, have its vision model check it is this dish with
 *    nothing odd in it; a rejected image fails the attempt (the queue retries once, stricter).
 *  - source: find a free library photo (Wikimedia Commons, Pexels), vetted the same way when the
 *    person has a vision-capable vendor; the house kitchen has no credential, so no vetting.
 * Either way the photo is stored through the normal media path with an attribution.
 */
export function imageJobHandler(db: Db, ai: Ai, photos: PhotoService, log: Logger) {
  return async (job: JobRow) => {
    const { recipeId, mode = 'auto' } = JSON.parse(job.payload) as ImageJobPayload;
    const row = one<RecipeRow>(
      db,
      'SELECT * FROM recipes WHERE id = ? AND user_id = ?',
      recipeId,
      job.user_id,
    );
    if (!row) throw new JobError('gone', 'The recipe no longer exists.', false);
    if (photos.hasUpload(recipeId))
      throw new JobError('has_photo', 'The recipe already has a photo.', false);
    if (row.forked_from_id)
      throw new JobError('adapted', 'Photos aren’t made for adapted copies.', false);

    const cred = ai.store.getCredential(job.user_id);
    const client = cred ? ai.clients[cred.vendor] : undefined;
    const content = parseContent(row);
    const resolved: Exclude<ImageJobMode, 'auto'> =
      mode === 'auto' ? (client?.generateImage ? 'generate' : 'source') : mode;

    if (resolved === 'source') {
      const check =
        cred && client?.describeImage
          ? {
              client,
              credential: cred.payload,
              onVerdict: (r: {
                grade: 'match' | 'food' | 'no';
                model: string;
                usage: { inputTokens: number | null; outputTokens: number | null };
                latencyMs: number;
              }) =>
                ai.recordAux(job.user_id, 'vision', client.vendor, r.model, 'ok', r.latencyMs, {
                  ...r.usage,
                  recipeId,
                  errorCode: r.grade === 'no' ? 'image_rejected' : null,
                }),
            }
          : null;
      try {
        const media = await photos.source({
          userId: job.user_id,
          recipeId,
          subject: content,
          check,
        });
        log.info(
          { recipeId, mediaId: media.id, source: media.source, attempt: job.attempts },
          'library photo saved',
        );
        return { recipeId, mediaId: media.id };
      } catch (err) {
        if (err instanceof PhotoError)
          throw new JobError(err.code, err.message, err.code === 'source_error');
        throw err;
      }
    }

    if (!cred) throw new JobError('no_credential', 'No AI account is connected.', false);
    if (!client?.generateImage)
      throw new JobError('no_image_support', `${cred.vendor} can’t generate images.`, false);
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
      ai.recordAux(job.user_id, 'image', client.vendor, out.model, 'ok', Date.now() - t0, {
        recipeId,
      });
    } catch (err) {
      const code = err instanceof AiError ? err.code : 'unknown';
      ai.recordAux(job.user_id, 'image', client.vendor, client.model, 'failed', Date.now() - t0, {
        errorCode: code,
        recipeId,
      });
      throw new JobError(
        code,
        (err as Error).message,
        !(code === 'credential_rejected' || code === 'credential_unusable'),
      );
    }

    // 2. Validate, when the vendor can look at pictures.
    if (client.describeImage) {
      const t1 = Date.now();
      try {
        const seen = await client.describeImage(
          png,
          {
            title: content.title,
            keyIngredients: content.ingredients.slice(0, 6).map((i) => i.item),
          },
          cred.payload,
        );
        ai.recordAux(job.user_id, 'vision', client.vendor, seen.model, 'ok', Date.now() - t1, {
          inputTokens: seen.usage.inputTokens,
          outputTokens: seen.usage.outputTokens,
          recipeId,
        });
        const v = seen.verdict;
        if (!v.isFood || !v.matchesDish || v.hasProblems) {
          log.info({ recipeId, attempt: job.attempts, verdict: v }, 'generated photo rejected');
          throw new JobError(
            'image_rejected',
            `The photo didn’t pass the check: ${v.note || 'not a convincing picture of the dish'}.`,
            true,
          );
        }
      } catch (err) {
        if (err instanceof JobError) throw err;
        const code = err instanceof AiError ? err.code : 'unknown';
        ai.recordAux(
          job.user_id,
          'vision',
          client.vendor,
          client.model,
          'failed',
          Date.now() - t1,
          { errorCode: code, recipeId },
        );
        throw new JobError(code, (err as Error).message, true);
      }
    }

    // 3. Store it like an upload: scrubbed, quota-checked, as the cover.
    const media = await photos.save({
      userId: job.user_id,
      recipeId,
      bytes: png,
      mime: 'image/png',
      ext: 'png',
      source: 'ai',
    });
    log.info(
      { recipeId, mediaId: media.id, model: imageModel, attempt: job.attempts },
      'generated photo saved',
    );
    return { recipeId, mediaId: media.id };
  };
}
