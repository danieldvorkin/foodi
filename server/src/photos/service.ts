import { unlink, writeFile } from 'node:fs/promises';
import type { MediaItem } from '@foodi/shared';
import type { CredentialPayload } from '../auth/providers/types.js';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import type { AiClient } from '../ai/types.js';
import { newId } from '../lib/crypto.js';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { imageSize, scrubImage } from '../lib/media-scrub.js';
import { now } from '../lib/time.js';
import { mediaForRecipe, toMediaItem, type MediaRow, type MediaStore } from '../routes/media.js';
import type { Settings } from '../services/settings.js';
import type { PhotoFinder, PhotoSubject } from './finder.js';
import { PhotoError, type PhotoCandidate } from './types.js';

/** How many auto photos a recipe keeps, so shuffling can go back a few. Oldest go first. */
export const MAX_AUTO_PHOTOS = 5;

export interface AutoPhotoInput {
  userId: string;
  recipeId: string;
  bytes: Buffer;
  mime: 'image/jpeg' | 'image/png';
  ext: string;
  source: 'ai' | 'wikimedia' | 'pexels' | 'google';
  credit?: string | null;
  license?: string | null;
  sourceUrl?: string | null;
}

/** A vision-capable client to vet library photos with, billed to that person's account. */
export interface PhotoCheck {
  client: AiClient;
  credential: CredentialPayload;
  onVerdict?: (r: {
    grade: 'match' | 'food' | 'no';
    model: string;
    usage: { inputTokens: number | null; outputTokens: number | null };
    latencyMs: number;
  }) => void;
}

export function createPhotoService(deps: {
  db: Db;
  mediaStore: MediaStore;
  settings: Settings;
  finder: PhotoFinder;
  log: Logger;
}) {
  const { db, mediaStore, settings, finder, log } = deps;

  /**
   * Store an auto photo as the recipe's cover: scrubbed, quota-checked, position 0. Earlier auto
   * photos shift down; beyond MAX_AUTO_PHOTOS the oldest are removed. Uploads keep their place.
   */
  async function save(input: AutoPhotoInput): Promise<MediaItem> {
    const bytes = scrubImage(input.mime, input.bytes);
    const capMb = settings.get().maxUploadMbPerUser;
    const used = one<{ n: number }>(
      db,
      'SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE owner_id = ?',
      input.userId,
    )!.n;
    if (capMb <= 0 || used + bytes.length > capMb * 1024 * 1024)
      throw new HttpError(413, 'quota', `The photo would exceed your ${capMb} MB of upload space.`);
    const dims = imageSize(input.mime, bytes);
    const id = newId('med');
    await writeFile(mediaStore.pathFor({ id, ext: input.ext }), bytes, { mode: 0o600 });
    const stale = all<MediaRow>(
      db,
      `SELECT * FROM media WHERE recipe_id = ? AND generated = 1 ORDER BY created_at DESC`,
      input.recipeId,
    ).slice(MAX_AUTO_PHOTOS - 1);
    tx(db, () => {
      for (const old of stale) run(db, 'DELETE FROM media WHERE id = ?', old.id);
      run(db, 'UPDATE media SET position = position + 1 WHERE recipe_id = ?', input.recipeId);
      run(
        db,
        `INSERT INTO media (id, owner_id, kind, mime, ext, bytes, width, height, recipe_id, post_id, position, created_at, generated, source, credit, license, source_url)
         VALUES (?, ?, 'image', ?, ?, ?, ?, ?, ?, NULL, 0, ?, 1, ?, ?, ?, ?)`,
        id,
        input.userId,
        input.mime,
        input.ext,
        bytes.length,
        dims?.width ?? null,
        dims?.height ?? null,
        input.recipeId,
        now(),
        input.source,
        input.credit ?? null,
        input.license ?? null,
        input.sourceUrl ?? null,
      );
    });
    for (const old of stale) await unlink(mediaStore.pathFor(old)).catch(() => {});
    return toMediaItem(one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', id)!);
  }

  /** Source pages this recipe has already been shown, or that the check turned down, so a shuffle moves on. */
  function seen(recipeId: string): Set<string> {
    return new Set([
      ...all<{ source_url: string }>(
        db,
        'SELECT source_url FROM media WHERE recipe_id = ? AND source_url IS NOT NULL',
        recipeId,
      ).map((r) => r.source_url),
      ...all<{ source_url: string }>(
        db,
        `SELECT source_url FROM photo_seen WHERE recipe_id = ? AND outcome = 'no'`,
        recipeId,
      ).map((r) => r.source_url),
    ]);
  }
  /** Grades already paid for: a photo looked at once is not sent to the vision model again. */
  function graded(recipeId: string): Map<string, 'match' | 'food'> {
    return new Map(
      all<{ source_url: string; outcome: 'match' | 'food' }>(
        db,
        `SELECT source_url, outcome FROM photo_seen WHERE recipe_id = ? AND outcome IN ('match','food')`,
        recipeId,
      ).map((r) => [r.source_url, r.outcome]),
    );
  }
  function remember(recipeId: string, sourceUrl: string, outcome: 'match' | 'food' | 'no') {
    run(
      db,
      'INSERT OR REPLACE INTO photo_seen (recipe_id, source_url, outcome, created_at) VALUES (?, ?, ?, ?)',
      recipeId,
      sourceUrl,
      outcome,
      now(),
    );
  }

  type Downloaded = Awaited<ReturnType<PhotoFinder['download']>>;
  type Looked =
    | { candidate: PhotoCandidate; file: Downloaded; grade: 'match' | 'food' | 'no' }
    | { candidate: PhotoCandidate; error: Error };

  /**
   * Find a library photo for the recipe and make it the cover. With `check`, a vision-capable
   * client looks at a few candidates at once: the best-ranked one that is clearly this dish wins,
   * one that is at least food is the fallback, and the rest are remembered so the next try moves
   * on. Batches keep coming until one passes — the person never sees "none of these", only "none
   * left". Without a check (the house account has no credential) the first fresh hit is used.
   */
  async function source(opts: {
    userId: string;
    recipeId: string;
    subject: PhotoSubject;
    check?: PhotoCheck | null;
  }): Promise<MediaItem> {
    const tried = seen(opts.recipeId);
    const known = graded(opts.recipeId);
    for (let batch = 0; batch < 4; batch++) {
      const candidates = await finder.findMany(opts.subject, tried, opts.check ? 3 : 2);
      if (!candidates.length) break;
      for (const c of candidates) tried.add(c.sourceUrl);
      const picked = await lookAt(opts, candidates, known);
      if (picked) return picked;
    }
    throw new PhotoError(
      'no_photo_found',
      tried.size
        ? 'No more photos of this dish in the libraries — add your own?'
        : 'No photo of this dish in the libraries — add your own?',
    );
  }

  /** Download and (when possible) check one batch; the best is saved as the cover, or null. */
  async function lookAt(
    opts: { userId: string; recipeId: string; subject: PhotoSubject; check?: PhotoCheck | null },
    candidates: PhotoCandidate[],
    known: Map<string, 'match' | 'food'>,
  ): Promise<MediaItem | null> {
    const keyIngredients = opts.subject.ingredients.slice(0, 6).map((i) => i.item);

    const looked: Looked[] = await Promise.all(
      candidates.map(async (candidate): Promise<Looked> => {
        try {
          const file = await finder.download(candidate);
          if (!opts.check?.client.describeImage) return { candidate, file, grade: 'match' };
          const cached = known.get(candidate.sourceUrl);
          if (cached) return { candidate, file, grade: cached };
          const t0 = Date.now();
          const seenIt = await opts.check.client.describeImage(
            file.bytes,
            { title: opts.subject.title, keyIngredients, library: true },
            opts.check.credential,
          );
          const v = seenIt.verdict;
          const grade = v.isFood && !v.hasProblems ? (v.matchesDish ? 'match' : 'food') : 'no';
          opts.check.onVerdict?.({
            grade,
            model: seenIt.model,
            usage: seenIt.usage,
            latencyMs: Date.now() - t0,
          });
          if (grade !== 'match')
            log.info(
              { recipeId: opts.recipeId, url: candidate.sourceUrl, verdict: v },
              grade === 'food'
                ? 'library photo is food but not this dish'
                : 'library photo rejected',
            );
          return { candidate, file, grade };
        } catch (error) {
          return { candidate, error: error as Error };
        }
      }),
    );

    // Without a check every download succeeds as a "match"; with one, prefer the dish, then food.
    const pick =
      looked.find((l) => 'grade' in l && l.grade === 'match') ??
      looked.find((l) => 'grade' in l && l.grade === 'food');
    for (const l of looked) {
      if (l === pick) continue;
      if ('grade' in l) remember(opts.recipeId, l.candidate.sourceUrl, l.grade);
      else log.warn({ err: l.error, url: l.candidate.url }, 'photo candidate failed');
    }
    if (pick && 'grade' in pick) {
      return save({
        userId: opts.userId,
        recipeId: opts.recipeId,
        bytes: pick.file.bytes,
        mime: pick.file.mime as 'image/jpeg' | 'image/png',
        ext: pick.file.ext,
        source: pick.candidate.provider,
        credit: pick.candidate.credit,
        license: pick.candidate.license,
        sourceUrl: pick.candidate.sourceUrl,
      });
    }
    const visionFailures = looked.filter((l) => 'error' in l && !(l.error instanceof PhotoError));
    if (looked.length && visionFailures.length === looked.length)
      throw new PhotoError(
        'source_error',
        `The photos couldn’t be checked: ${(visionFailures[0] as { error: Error }).error.message}`,
      );
    return null;
  }

  /** Make an existing photo of the recipe the cover (position 0), keeping the rest in order. */
  function setCover(recipeId: string, mediaId: string): MediaItem[] {
    const rows = all<MediaRow>(
      db,
      'SELECT * FROM media WHERE recipe_id = ? ORDER BY position, created_at',
      recipeId,
    );
    const chosen = rows.find((m) => m.id === mediaId);
    if (!chosen || chosen.kind !== 'image')
      throw new HttpError(404, 'not_found', 'That photo is not on this recipe.');
    tx(db, () => {
      let pos = 1;
      for (const m of rows)
        run(db, 'UPDATE media SET position = ? WHERE id = ?', m.id === mediaId ? 0 : pos++, m.id);
    });
    return mediaForRecipe(db, recipeId);
  }

  /**
   * Queue a library photo for every recipe of `ownerId` that has no image and no photo job in
   * flight. Used for the house kitchen: at boot, and from the admin panel.
   */
  function backfill(jobs: { enqueue: (kind: 'image', userId: string, payload: unknown, maxAttempts: number, recipeId: string) => unknown }, ownerId: string, limit = 500): number {
    const missing = all<{ id: string }>(
      db,
      `SELECT r.id FROM recipes r
       WHERE r.user_id = ? AND r.forked_from_id IS NULL
         AND NOT EXISTS (SELECT 1 FROM media m WHERE m.recipe_id = r.id AND m.kind = 'image')
         AND NOT EXISTS (SELECT 1 FROM jobs j WHERE j.result_recipe_id = r.id AND j.kind = 'image' AND j.status IN ('queued','running'))
       ORDER BY r.created_at LIMIT ?`,
      ownerId,
      limit,
    );
    for (const { id } of missing) jobs.enqueue('image', ownerId, { recipeId: id, mode: 'source' }, 1, id);
    return missing.length;
  }

  function hasUpload(recipeId: string): boolean {
    return Boolean(
      one(
        db,
        `SELECT 1 FROM media WHERE recipe_id = ? AND kind = 'image' AND generated = 0`,
        recipeId,
      ),
    );
  }

  return { save, source, setCover, seen, hasUpload, backfill, finder };
}

export type PhotoService = ReturnType<typeof createPhotoService>;
