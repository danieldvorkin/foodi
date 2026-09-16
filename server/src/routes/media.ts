import { Router, type Request } from 'express';
import express from 'express';
import { createReadStream, statSync } from 'node:fs';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import type { MediaItem } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
import { imageSize, scrubImage, sniffMedia } from '../lib/media-scrub.js';
import type { Logger } from '../lib/logger.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import type { Settings } from '../services/settings.js';

export interface MediaRow {
  id: string;
  owner_id: string;
  kind: 'image' | 'video';
  mime: string;
  ext: string;
  bytes: number;
  width: number | null;
  height: number | null;
  recipe_id: string | null;
  post_id: string | null;
  blog_id: string | null;
  position: number;
  created_at: string;
}

export const IMAGE_LIMIT = 12 * 1024 * 1024;
export const VIDEO_LIMIT = 120 * 1024 * 1024;

export function toMediaItem(m: MediaRow): MediaItem {
  return { id: m.id, kind: m.kind, mime: m.mime, width: m.width, height: m.height, bytes: m.bytes, createdAt: m.created_at };
}

export function mediaForRecipe(db: Db, recipeId: string): MediaItem[] {
  return all<MediaRow>(db, 'SELECT * FROM media WHERE recipe_id = ? ORDER BY position, created_at', recipeId).map(toMediaItem);
}
export function mediaForPost(db: Db, postId: string): MediaItem[] {
  return all<MediaRow>(db, 'SELECT * FROM media WHERE post_id = ? ORDER BY position, created_at', postId).map(toMediaItem);
}
export function coverForRecipe(db: Db, recipeId: string): MediaItem | null {
  const m = one<MediaRow>(db, `SELECT * FROM media WHERE recipe_id = ? AND kind = 'image' ORDER BY position, created_at LIMIT 1`, recipeId);
  return m ? toMediaItem(m) : null;
}

export function createMediaStore(db: Db, dir: string, log: Logger) {
  const root = resolve(dir);
  void mkdir(root, { recursive: true });
  const pathFor = (m: Pick<MediaRow, 'id' | 'ext'>) => join(root, `${m.id}.${m.ext}`);

  /** Delete a media row and its file. Safe to call for missing files. */
  async function remove(id: string) {
    const m = one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', id);
    if (!m) return;
    run(db, 'DELETE FROM media WHERE id = ?', id);
    await unlink(pathFor(m)).catch(() => {});
  }

  /** Remove files whose rows were cascaded away (recipe/post/user deletes). Runs periodically. */
  async function sweepOrphans() {
    const { readdir } = await import('node:fs/promises');
    const files = await readdir(root).catch(() => [] as string[]);
    const known = new Set(all<{ id: string; ext: string }>(db, 'SELECT id, ext FROM media').map((m) => `${m.id}.${m.ext}`));
    let n = 0;
    for (const f of files) {
      if (!known.has(f) && /^med_[A-Za-z0-9_-]+\.[a-z0-9]+$/.test(f)) {
        await unlink(join(root, f)).catch(() => {});
        n++;
      }
    }
    if (n) log.info({ n }, 'removed orphaned media files');
  }

  return { root, pathFor, remove, sweepOrphans };
}
export type MediaStore = ReturnType<typeof createMediaStore>;

export function mediaRoutes(db: Db, store: MediaStore, settings: Settings) {
  const r = Router();

  /** Can this person see this media? Own it, or it hangs off a shared recipe/post. */
  function canView(m: MediaRow, req: Request): boolean {
    const userId = req.user?.id;
    if (!userId) return false;
    if (m.owner_id === userId || req.user?.role === 'admin') return true;
    if (m.recipe_id) {
      const rec = one<{ visibility: string }>(db, 'SELECT visibility FROM recipes WHERE id = ?', m.recipe_id);
      if (rec?.visibility === 'public') return true;
    }
    if (m.post_id) return true; // posts are visible to every signed-in person
    if (m.blog_id) {
      const b = one<{ status: string }>(db, 'SELECT status FROM blog_posts WHERE id = ?', m.blog_id);
      if (b?.status === 'published') return true;
    }
    return false;
  }

  r.get('/:id', requireAuth, (req, res) => {
    const m = one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', req.params['id']);
    if (!m || !canView(m, req)) throw notFound('That file is gone.');
    const path = store.pathFor(m);
    let size: number;
    try {
      size = statSync(path).size;
    } catch {
      throw notFound('That file is gone.');
    }
    res.setHeader('content-type', m.mime);
    res.setHeader('x-content-type-options', 'nosniff');
    res.setHeader('content-disposition', 'inline');
    res.setHeader('cache-control', 'private, max-age=86400');
    res.setHeader('accept-ranges', 'bytes');
    const range = req.headers.range;
    if (range && m.kind === 'video') {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (match) {
        const start = match[1] ? Number(match[1]) : 0;
        const end = match[2] ? Math.min(Number(match[2]), size - 1) : size - 1;
        if (start <= end && start < size) {
          res.status(206);
          res.setHeader('content-range', `bytes ${start}-${end}/${size}`);
          res.setHeader('content-length', end - start + 1);
          createReadStream(path, { start, end }).pipe(res);
          return;
        }
      }
    }
    res.setHeader('content-length', size);
    createReadStream(path).pipe(res);
  });

  /**
   * Upload one file as the raw request body. The browser sends the File as-is with its type;
   * we sniff the real type from the bytes, strip image metadata, and store under a random id.
   * Attach with ?recipeId= (must be yours) or leave unattached and attach when creating a post.
   */
  r.post(
    '/',
    requireAuth,
    express.raw({ type: () => true, limit: VIDEO_LIMIT }),
    async (req, res, next) => {
      try {
        const me = req.user!;
        const capMb = settings.get().maxUploadMbPerUser;
        if (capMb <= 0) throw forbidden('Uploads are turned off.');
        const buf = req.body as Buffer;
        if (!Buffer.isBuffer(buf) || buf.length === 0) throw badRequest('Send the file as the request body.');
        const sniffed = sniffMedia(buf);
        if (!sniffed) throw badRequest('Use a JPEG, PNG, WebP, GIF, MP4, MOV or WebM file.');
        if (sniffed.kind === 'image' && buf.length > IMAGE_LIMIT) throw badRequest('Images can be up to 12 MB.');
        const used = one<{ n: number }>(db, 'SELECT COALESCE(SUM(bytes), 0) AS n FROM media WHERE owner_id = ?', me.id)!.n;
        if (used + buf.length > capMb * 1024 * 1024) throw new HttpError(413, 'quota', `You've used your ${capMb} MB of upload space. Delete some photos to free up room.`);

        const recipeId = typeof req.query['recipeId'] === 'string' ? req.query['recipeId'] : null;
        if (recipeId) {
          const rec = one<{ user_id: string }>(db, 'SELECT user_id FROM recipes WHERE id = ?', recipeId);
          if (!rec || rec.user_id !== me.id) throw notFound('That recipe is not yours.');
          const count = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM media WHERE recipe_id = ?', recipeId)!.n;
          if (count >= 8) throw badRequest('A recipe can have up to 8 photos or videos.');
        }

        const bytes = sniffed.kind === 'image' ? scrubImage(sniffed.mime, buf) : buf;
        const dims = sniffed.kind === 'image' ? imageSize(sniffed.mime, bytes) : null;
        const id = newId('med');
        await writeFile(store.pathFor({ id, ext: sniffed.ext }), bytes, { mode: 0o600 });
        const position = recipeId ? one<{ n: number }>(db, 'SELECT COALESCE(MAX(position), -1) + 1 AS n FROM media WHERE recipe_id = ?', recipeId)!.n : 0;
        run(
          db,
          `INSERT INTO media (id, owner_id, kind, mime, ext, bytes, width, height, recipe_id, post_id, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?)`,
          id,
          me.id,
          sniffed.kind,
          sniffed.mime,
          sniffed.ext,
          bytes.length,
          dims?.width ?? null,
          dims?.height ?? null,
          recipeId,
          position,
          now(),
        );
        const m = one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', id)!;
        res.status(201).json({ media: toMediaItem(m) });
      } catch (e) {
        next(e);
      }
    },
  );

  r.delete('/:id', requireAuth, async (req, res, next) => {
    try {
      const m = one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', req.params['id']);
      if (!m) throw notFound('That file is gone.');
      if (m.owner_id !== req.user!.id && req.user!.role !== 'admin') throw forbidden('Only the owner can delete this.');
      await store.remove(m.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  r.get('/', requireAuth, (req, res) => {
    const rows = all<MediaRow>(db, 'SELECT * FROM media WHERE owner_id = ? ORDER BY created_at DESC LIMIT 200', req.user!.id);
    const used = rows.reduce((a, m) => a + m.bytes, 0);
    res.json({ media: rows.map(toMediaItem), usedBytes: used, capBytes: settings.get().maxUploadMbPerUser * 1024 * 1024 });
  });

  return r;
}
