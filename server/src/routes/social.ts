import { Router } from 'express';
import { z } from 'zod';
import {
  CreateCommentSchema,
  CreatePostSchema,
  UpdateSocialProfileSchema,
  type Comment,
  type Post,
  type PublicProfile,
  RecipeContentSchema,
} from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { coverForRecipe, mediaForPost, type MediaRow } from './media.js';

interface PostRow {
  id: string;
  caption: string;
  created_at: string;
  author_id: string;
  author_handle: string;
  author_name: string | null;
  author_avatar: string;
  recipe_id: string;
  recipe_source: 'ai' | 'user';
  recipe_content: string;
  like_count: number;
  comment_count: number;
  liked_by_me: number;
}

const POST_SELECT = `
  SELECT p.id, p.caption, p.created_at, p.author_id, u.handle AS author_handle, u.display_name AS author_name, u.avatar_emoji AS author_avatar,
         r.id AS recipe_id, r.source AS recipe_source, r.content AS recipe_content,
         (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS like_count,
         (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comment_count,
         EXISTS(SELECT 1 FROM likes l2 WHERE l2.post_id = p.id AND l2.user_id = ?) AS liked_by_me
  FROM posts p JOIN users u ON u.id = p.author_id JOIN recipes r ON r.id = p.recipe_id
  WHERE u.disabled_at IS NULL`;

function toPost(db: Db, row: PostRow, me: string): Post {
  const c = RecipeContentSchema.parse(JSON.parse(row.recipe_content));
  return {
    id: row.id,
    caption: row.caption,
    createdAt: row.created_at,
    author: { id: row.author_id, handle: row.author_handle, displayName: row.author_name ?? row.author_handle, avatar: row.author_avatar },
    media: mediaForPost(db, row.id),
    recipe: {
      id: row.recipe_id,
      emoji: c.emoji,
      cover: coverForRecipe(db, row.recipe_id),
      title: c.title,
      summary: c.summary,
      mealType: c.mealType,
      totalMinutes: c.totalMinutes,
      difficulty: c.difficulty,
      servings: c.servings,
      source: row.recipe_source,
      ingredientCount: c.ingredients.length,
    },
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: Boolean(row.liked_by_me),
    isMine: row.author_id === me,
  };
}

/** After a post is removed, make its recipe private again unless another post still shares it. */
export function unshareIfOrphan(db: Db, recipeId: string) {
  if (!one(db, 'SELECT 1 FROM posts WHERE recipe_id = ?', recipeId)) {
    run(db, `UPDATE recipes SET visibility = 'private', updated_at = ? WHERE id = ?`, now(), recipeId);
  }
}

export function socialRoutes(db: Db) {
  const r = Router();
  r.use(requireAuth);

  // ---- feed -------------------------------------------------------------------------------
  r.get('/feed', (req, res) => {
    const me = req.user!.id;
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : null;
    const rows = before
      ? all<PostRow>(db, `${POST_SELECT} AND p.created_at < ? ORDER BY p.created_at DESC LIMIT 20`, me, before)
      : all<PostRow>(db, `${POST_SELECT} ORDER BY p.created_at DESC LIMIT 20`, me);
    res.json({ posts: rows.map((x) => toPost(db, x, me)), nextBefore: rows.length === 20 ? rows[rows.length - 1]!.created_at : null });
  });

  r.post('/posts', (req, res) => {
    const me = req.user!.id;
    const body = parse(CreatePostSchema, req.body);
    const recipe = one<{ id: string; user_id: string }>(db, 'SELECT id, user_id FROM recipes WHERE id = ?', body.recipeId);
    if (!recipe || recipe.user_id !== me) throw notFound('Pick one of your own recipes to share.');
    const recent = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM posts WHERE author_id = ? AND created_at > ?`, me, new Date(Date.now() - 3600_000).toISOString());
    if ((recent?.n ?? 0) >= 20) throw conflict('That’s a lot of posts in an hour. Take a break and try again later.');
    const id = newId('pst');
    const media = body.mediaIds.map((mid) => one<MediaRow>(db, 'SELECT * FROM media WHERE id = ?', mid));
    if (media.some((m) => !m || m.owner_id !== me || m.post_id)) throw badRequest('One of the attached files is not yours or is already used.');
    tx(db, () => {
      run(db, `INSERT INTO posts (id, author_id, recipe_id, caption, created_at) VALUES (?, ?, ?, ?, ?)`, id, me, body.recipeId, body.caption, now());
      // Sharing makes the recipe readable by other signed-in people.
      run(db, `UPDATE recipes SET visibility = 'public', updated_at = ? WHERE id = ?`, now(), body.recipeId);
      media.forEach((m, i) => run(db, 'UPDATE media SET post_id = ?, position = ? WHERE id = ?', id, i, m!.id));
    });
    const row = one<PostRow>(db, `${POST_SELECT} AND p.id = ?`, me, id)!;
    res.status(201).json({ post: toPost(db, row, me) });
  });

  r.get('/posts/:id', (req, res) => {
    const me = req.user!.id;
    const row = one<PostRow>(db, `${POST_SELECT} AND p.id = ?`, me, req.params['id']);
    if (!row) throw notFound('That post is gone.');
    const comments = all<{ id: string; body: string; created_at: string; author_id: string; handle: string; display_name: string | null; avatar_emoji: string }>(
      db,
      `SELECT c.id, c.body, c.created_at, c.author_id, u.handle, u.display_name, u.avatar_emoji FROM comments c JOIN users u ON u.id = c.author_id WHERE c.post_id = ? ORDER BY c.created_at ASC LIMIT 200`,
      row.id,
    );
    const list: Comment[] = comments.map((c) => ({
      id: c.id,
      body: c.body,
      createdAt: c.created_at,
      author: { id: c.author_id, handle: c.handle, displayName: c.display_name ?? c.handle, avatar: c.avatar_emoji },
      isMine: c.author_id === me,
    }));
    res.json({ post: toPost(db, row, me), comments: list });
  });

  r.delete('/posts/:id', (req, res) => {
    const me = req.user!.id;
    const post = one<{ id: string; author_id: string; recipe_id: string }>(db, 'SELECT id, author_id, recipe_id FROM posts WHERE id = ?', req.params['id']);
    if (!post) throw notFound('That post is gone.');
    if (post.author_id !== me) throw forbidden('Only the author can delete this post.');
    tx(db, () => {
      run(db, 'DELETE FROM posts WHERE id = ?', post.id);
      unshareIfOrphan(db, post.recipe_id);
    });
    res.json({ ok: true });
  });

  r.post('/posts/:id/like', (req, res) => {
    const me = req.user!.id;
    const liked = parse(z.object({ liked: z.boolean() }), req.body).liked;
    if (!one(db, 'SELECT 1 FROM posts WHERE id = ?', req.params['id'])) throw notFound('That post is gone.');
    if (liked) run(db, 'INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)', req.params['id'], me, now());
    else run(db, 'DELETE FROM likes WHERE post_id = ? AND user_id = ?', req.params['id'], me);
    const count = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', req.params['id'])!.n;
    res.json({ liked, likeCount: count });
  });

  r.post('/posts/:id/comments', (req, res) => {
    const me = req.user!.id;
    const body = parse(CreateCommentSchema, req.body);
    if (!one(db, 'SELECT 1 FROM posts WHERE id = ?', req.params['id'])) throw notFound('That post is gone.');
    const id = newId('cmt');
    run(db, `INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, id, req.params['id'], me, body.body, now());
    const u = req.user!;
    const comment: Comment = { id, body: body.body, createdAt: now(), author: { id: me, handle: u.handle, displayName: u.display_name ?? u.handle, avatar: u.avatar_emoji }, isMine: true };
    res.status(201).json({ comment });
  });

  r.delete('/comments/:id', (req, res) => {
    const me = req.user!.id;
    const c = one<{ author_id: string; post_id: string }>(db, 'SELECT author_id, post_id FROM comments WHERE id = ?', req.params['id']);
    if (!c) throw notFound('That comment is gone.');
    const postAuthor = one<{ author_id: string }>(db, 'SELECT author_id FROM posts WHERE id = ?', c.post_id)?.author_id;
    if (c.author_id !== me && postAuthor !== me) throw forbidden('You can delete your own comments, or comments on your posts.');
    run(db, 'DELETE FROM comments WHERE id = ?', req.params['id']);
    res.json({ ok: true });
  });

  // ---- profiles ---------------------------------------------------------------------------
  function publicProfile(handle: string, me: string): PublicProfile {
    const u = one<{ id: string; handle: string; display_name: string | null; bio: string; created_at: string; avatar_emoji: string }>(
      db,
      'SELECT id, handle, display_name, bio, created_at, avatar_emoji FROM users WHERE handle = ? AND disabled_at IS NULL',
      handle,
    );
    if (!u) throw notFound('No one goes by that handle.');
    const postCount = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM posts WHERE author_id = ?', u.id)!.n;
    const likeCount = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = ?', u.id)!.n;
    return { id: u.id, handle: u.handle, displayName: u.display_name ?? u.handle, avatar: u.avatar_emoji, bio: u.bio, createdAt: u.created_at, postCount, likeCount, isMe: u.id === me };
  }

  r.get('/profiles/:handle', (req, res) => {
    const me = req.user!.id;
    const profile = publicProfile(req.params['handle']!.toLowerCase(), me);
    const rows = all<PostRow>(db, `${POST_SELECT} AND p.author_id = ? ORDER BY p.created_at DESC LIMIT 50`, me, profile.id);
    res.json({ profile, posts: rows.map((x) => toPost(db, x, me)) });
  });

  r.put('/profile', (req, res) => {
    const me = req.user!;
    const body = parse(UpdateSocialProfileSchema, req.body);
    const taken = one<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ? AND id != ?', body.handle, me.id);
    if (taken) throw badRequest('That handle is taken.');
    run(db, 'UPDATE users SET handle = ?, bio = ?, avatar_emoji = ? WHERE id = ?', body.handle, body.bio, body.avatar, me.id);
    res.json({ profile: publicProfile(body.handle, me.id) });
  });

  r.get('/profile', (req, res) => {
    res.json({ profile: publicProfile(req.user!.handle, req.user!.id) });
  });

  return r;
}
