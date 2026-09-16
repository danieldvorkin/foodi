import { Router } from 'express';
import { z } from 'zod';
import { CreateCommentSchema, RecipeContentSchema, UpsertBlogPostSchema, type BlogPost, type Comment } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { toMediaItem, type MediaRow } from './media.js';
import type { Notifier } from '../services/notify.js';

export interface BlogRow {
  id: string;
  author_id: string;
  author_handle: string;
  author_name: string | null;
  author_avatar: string;
  title: string;
  body: string;
  status: 'draft' | 'published';
  cover_media_id: string | null;
  published_at: string | null;
  created_at: string;
  updated_at: string;
  like_count: number;
  comment_count: number;
  liked_by_me: number;
}

export const BLOG_SELECT = `
  SELECT b.id, b.author_id, u.handle AS author_handle, u.display_name AS author_name, u.avatar_emoji AS author_avatar,
         b.title, b.body, b.status, b.cover_media_id, b.published_at, b.created_at, b.updated_at,
         (SELECT COUNT(*) FROM blog_likes l WHERE l.blog_id = b.id) AS like_count,
         (SELECT COUNT(*) FROM blog_comments c WHERE c.blog_id = b.id) AS comment_count,
         EXISTS(SELECT 1 FROM blog_likes l2 WHERE l2.blog_id = b.id AND l2.user_id = ?) AS liked_by_me
  FROM blog_posts b JOIN users u ON u.id = b.author_id
  WHERE u.disabled_at IS NULL`;

/** First ~200 characters of prose: headings are dropped, list items read as sentences, markdown is stripped. */
export function excerptOf(body: string): string {
  const text = body
    .replace(/\r\n?/g, '\n')
    .split(/\n{2,}/)
    .map((block) =>
      block
        .split('\n')
        .filter((l) => l.trim() && !/^#{1,3}\s+/.test(l))
        .map((l) => l.replace(/^\s*[-*]\s+/, '').trim())
        .map((l) => (/[.!?…:]$/.test(l) ? l : `${l}.`))
        .join(' '),
    )
    .filter(Boolean)
    .join(' ')
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/_(.+?)_/g, '$1')
    .replace(/\[(.+?)\]\((.+?)\)/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
  return text.length > 200 ? `${text.slice(0, 197).trimEnd()}…` : text;
}

export function toBlogPost(db: Db, row: BlogRow, me: string): BlogPost {
  const media = all<MediaRow>(db, 'SELECT * FROM media WHERE blog_id = ? ORDER BY position, created_at', row.id).map(toMediaItem);
  const cover = media.find((m) => m.id === row.cover_media_id) ?? media.find((m) => m.kind === 'image') ?? null;
  const recipes = all<{ id: string; content: string }>(
    db,
    `SELECT r.id, r.content FROM blog_post_recipes x JOIN recipes r ON r.id = x.recipe_id WHERE x.blog_id = ? AND (r.visibility = 'public' OR r.user_id = ?) ORDER BY x.position`,
    row.id,
    me,
  ).map((r) => {
    const c = RecipeContentSchema.parse(JSON.parse(r.content));
    return { id: r.id, emoji: c.emoji, title: c.title, totalMinutes: c.totalMinutes, difficulty: c.difficulty };
  });
  const words = row.body.split(/\s+/).filter(Boolean).length;
  return {
    id: row.id,
    title: row.title,
    body: row.body,
    excerpt: excerptOf(row.body),
    status: row.status,
    readingMinutes: Math.max(1, Math.round(words / 220)),
    author: { id: row.author_id, handle: row.author_handle, displayName: row.author_name ?? row.author_handle, avatar: row.author_avatar },
    cover,
    media,
    recipes,
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: Boolean(row.liked_by_me),
    isMine: row.author_id === me,
    publishedAt: row.published_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function blogRoutes(db: Db, notifier: Notifier) {
  const r = Router();
  r.use(requireAuth);

  /** Published posts, newest first. ?author=handle narrows to one person (their drafts too, if it's you). */
  r.get('/', (req, res) => {
    const me = req.user!.id;
    const author = typeof req.query['author'] === 'string' ? req.query['author'].toLowerCase() : null;
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : null;
    const params: unknown[] = [me];
    let where = '';
    if (author) {
      where += ' AND u.handle = ?';
      params.push(author);
      where += ` AND (b.status = 'published' OR b.author_id = ?)`;
      params.push(me);
    } else where += ` AND b.status = 'published'`;
    if (before) {
      where += ' AND COALESCE(b.published_at, b.created_at) < ?';
      params.push(before);
    }
    const rows = all<BlogRow>(db, `${BLOG_SELECT}${where} ORDER BY COALESCE(b.published_at, b.created_at) DESC LIMIT 20`, ...params);
    const posts = rows.map((x) => toBlogPost(db, x, me));
    res.json({ posts, nextBefore: rows.length === 20 ? (rows[rows.length - 1]!.published_at ?? rows[rows.length - 1]!.created_at) : null });
  });

  function attach(id: string, me: string, body: z.infer<typeof UpsertBlogPostSchema>) {
    const recipes = body.recipeIds.map((rid) => one<{ id: string; user_id: string; visibility: string }>(db, 'SELECT id, user_id, visibility FROM recipes WHERE id = ?', rid));
    if (recipes.some((x) => !x || (x.user_id !== me && x.visibility !== 'public'))) throw badRequest('One of the attached recipes is private or gone.');
    const media = body.mediaIds.map((mid) => one<MediaRow & { blog_id: string | null }>(db, 'SELECT * FROM media WHERE id = ?', mid));
    if (media.some((m) => !m || m.owner_id !== me || m.post_id || m.recipe_id || (m.blog_id && m.blog_id !== id))) throw badRequest('One of the attached files is not yours or is already used.');
    if (body.coverMediaId && !body.mediaIds.includes(body.coverMediaId)) throw badRequest('The cover has to be one of the attached photos.');
    run(db, 'DELETE FROM blog_post_recipes WHERE blog_id = ?', id);
    recipes.forEach((x, i) => run(db, 'INSERT OR IGNORE INTO blog_post_recipes (blog_id, recipe_id, position) VALUES (?, ?, ?)', id, x!.id, i));
    // Detach files no longer listed; attach the rest in order.
    run(db, 'UPDATE media SET blog_id = NULL WHERE blog_id = ?', id);
    media.forEach((m, i) => run(db, 'UPDATE media SET blog_id = ?, position = ? WHERE id = ?', id, i, m!.id));
    run(db, 'UPDATE blog_posts SET cover_media_id = ? WHERE id = ?', body.coverMediaId, id);
  }

  r.post('/', (req, res) => {
    const me = req.user!.id;
    const body = parse(UpsertBlogPostSchema, req.body);
    const recent = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM blog_posts WHERE author_id = ? AND created_at > ?`, me, new Date(Date.now() - 3600_000).toISOString());
    if ((recent?.n ?? 0) >= 10) throw conflict('That’s a lot of posts in an hour. Take a break and try again later.');
    const id = newId('blg');
    const t = now();
    tx(db, () => {
      run(
        db,
        `INSERT INTO blog_posts (id, author_id, title, body, status, cover_media_id, published_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        id,
        me,
        body.title,
        body.body,
        body.status,
        body.status === 'published' ? t : null,
        t,
        t,
      );
      attach(id, me, body);
    });
    if (body.status === 'published') notifier.sendToFollowers(me, 'post', { blogId: id });
    const row = one<BlogRow>(db, `${BLOG_SELECT} AND b.id = ?`, me, id)!;
    res.status(201).json({ post: toBlogPost(db, row, me) });
  });

  r.get('/:id', (req, res) => {
    const me = req.user!.id;
    const row = one<BlogRow>(db, `${BLOG_SELECT} AND b.id = ?`, me, req.params['id']);
    if (!row || (row.status === 'draft' && row.author_id !== me && req.user!.role !== 'admin')) throw notFound('That post is gone.');
    const comments = all<{ id: string; body: string; created_at: string; author_id: string; handle: string; display_name: string | null; avatar_emoji: string }>(
      db,
      `SELECT c.id, c.body, c.created_at, c.author_id, u.handle, u.display_name, u.avatar_emoji FROM blog_comments c JOIN users u ON u.id = c.author_id WHERE c.blog_id = ? ORDER BY c.created_at ASC LIMIT 200`,
      row.id,
    );
    const list: Comment[] = comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      author: { id: c.author_id, handle: c.handle, displayName: c.display_name ?? c.handle, avatar: c.avatar_emoji },
      isMine: c.author_id === me,
    }));
    res.json({ post: toBlogPost(db, row, me), comments: list });
  });

  r.put('/:id', (req, res) => {
    const me = req.user!.id;
    const body = parse(UpsertBlogPostSchema, req.body);
    const existing = one<{ author_id: string; status: string; published_at: string | null }>(db, 'SELECT author_id, status, published_at FROM blog_posts WHERE id = ?', req.params['id']);
    if (!existing) throw notFound('That post is gone.');
    if (existing.author_id !== me) throw forbidden('Only the author can edit this post.');
    const id = req.params['id']!;
    const t = now();
    const firstPublish = body.status === 'published' && existing.status === 'draft';
    tx(db, () => {
      run(
        db,
        `UPDATE blog_posts SET title = ?, body = ?, status = ?, published_at = ?, updated_at = ? WHERE id = ?`,
        body.title,
        body.body,
        body.status,
        body.status === 'published' ? (existing.published_at ?? t) : null,
        t,
        id,
      );
      attach(id, me, body);
    });
    if (firstPublish) notifier.sendToFollowers(me, 'post', { blogId: id });
    const row = one<BlogRow>(db, `${BLOG_SELECT} AND b.id = ?`, me, id)!;
    res.json({ post: toBlogPost(db, row, me) });
  });

  r.delete('/:id', (req, res) => {
    const me = req.user!;
    const existing = one<{ author_id: string }>(db, 'SELECT author_id FROM blog_posts WHERE id = ?', req.params['id']);
    if (!existing) throw notFound('That post is gone.');
    if (existing.author_id !== me.id && me.role !== 'admin') throw forbidden('Only the author can delete this post.');
    run(db, 'DELETE FROM blog_posts WHERE id = ?', req.params['id']);
    res.json({ ok: true });
  });

  r.post('/:id/like', (req, res) => {
    const me = req.user!.id;
    const liked = parse(z.object({ liked: z.boolean() }), req.body).liked;
    const target = one<{ author_id: string; status: string }>(db, 'SELECT author_id, status FROM blog_posts WHERE id = ?', req.params['id']);
    if (!target || target.status !== 'published') throw notFound('That post is gone.');
    if (liked) {
      run(db, 'INSERT OR IGNORE INTO blog_likes (blog_id, user_id, created_at) VALUES (?, ?, ?)', req.params['id'], me, now());
      notifier.send(target.author_id, 'like', { actorId: me, blogId: req.params['id']! });
    } else run(db, 'DELETE FROM blog_likes WHERE blog_id = ? AND user_id = ?', req.params['id'], me);
    const count = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM blog_likes WHERE blog_id = ?', req.params['id'])!.n;
    res.json({ liked, likeCount: count });
  });

  r.post('/:id/comments', (req, res) => {
    const me = req.user!.id;
    const body = parse(CreateCommentSchema, req.body);
    const target = one<{ author_id: string; status: string }>(db, 'SELECT author_id, status FROM blog_posts WHERE id = ?', req.params['id']);
    if (!target || target.status !== 'published') throw notFound('That post is gone.');
    const id = newId('bcm');
    run(db, `INSERT INTO blog_comments (id, blog_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, id, req.params['id'], me, body.body, now());
    notifier.send(target.author_id, 'comment', { actorId: me, blogId: req.params['id']!, commentId: id });
    const u = req.user!;
    const comment: Comment = { id, body: body.body, createdAt: now(), author: { id: me, handle: u.handle, displayName: u.display_name ?? u.handle, avatar: u.avatar_emoji }, isMine: true };
    res.status(201).json({ comment });
  });

  r.delete('/comments/:id', (req, res) => {
    const me = req.user!;
    const c = one<{ author_id: string; blog_id: string }>(db, 'SELECT author_id, blog_id FROM blog_comments WHERE id = ?', req.params['id']);
    if (!c) throw notFound('That comment is gone.');
    const postAuthor = one<{ author_id: string }>(db, 'SELECT author_id FROM blog_posts WHERE id = ?', c.blog_id)?.author_id;
    if (c.author_id !== me.id && postAuthor !== me.id && me.role !== 'admin') throw forbidden('You can delete your own comments, or comments on your posts.');
    run(db, 'DELETE FROM blog_comments WHERE id = ?', req.params['id']);
    res.json({ ok: true });
  });

  return r;
}
