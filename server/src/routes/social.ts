import { Router } from 'express';
import { z } from 'zod';
import {
  CreateCommentSchema,
  CreatePostSchema,
  FEED_SCOPES,
  UpdateSocialProfileSchema,
  type Comment,
  type FeedItem,
  type Person,
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
import { BLOG_SELECT, toBlogPost, type BlogRow } from './blog.js';
import { BOOK_SELECT, booksFor, toBook } from './books.js';
import type { Notifier } from '../services/notify.js';
import type { Commerce } from '../services/commerce.js';

interface PostRow {
  id: string;
  caption: string;
  created_at: string;
  author_id: string;
  author_handle: string;
  author_name: string | null;
  author_avatar: string;
  author_system: number;
  recipe_id: string;
  recipe_source: 'ai' | 'user';
  recipe_content: string;
  forked_from_id: string | null;
  forked_from_title: string | null;
  forked_from_handle: string | null;
  like_count: number;
  comment_count: number;
  liked_by_me: number;
}

const POST_SELECT = `
  SELECT p.id, p.caption, p.created_at, p.author_id, u.handle AS author_handle, u.display_name AS author_name, u.avatar_emoji AS author_avatar, u.is_system AS author_system,
         r.id AS recipe_id, r.source AS recipe_source, r.content AS recipe_content,
         r.forked_from_id, r.forked_from_title, r.forked_from_handle,
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
      adaptedFrom: row.forked_from_title
        ? { id: row.forked_from_id && one(db, 'SELECT 1 FROM recipes WHERE id = ?', row.forked_from_id) ? row.forked_from_id : null, title: row.forked_from_title, handle: row.forked_from_handle ?? '' }
        : null,
    },
    likeCount: row.like_count,
    commentCount: row.comment_count,
    likedByMe: Boolean(row.liked_by_me),
    isMine: row.author_id === me,
    isHouse: Boolean(row.author_system),
    commentsEnabled: !row.author_system,
  };
}

/** After a post is removed, make its recipe private again unless another post still shares it. */
export function unshareIfOrphan(db: Db, recipeId: string) {
  if (!one(db, 'SELECT 1 FROM posts WHERE recipe_id = ?', recipeId)) {
    run(db, `UPDATE recipes SET visibility = 'private', updated_at = ? WHERE id = ?`, now(), recipeId);
  }
}

export function socialRoutes(db: Db, notifier: Notifier, commerce: Commerce) {
  const r = Router();
  r.use(requireAuth);

  // ---- feed -------------------------------------------------------------------------------
  /** Recipe posts and blog posts, newest first. ?scope=following narrows to people you follow (and you). */
  r.get('/feed', (req, res) => {
    const me = req.user!.id;
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : null;
    const scope = FEED_SCOPES.includes(req.query['scope'] as never) ? (req.query['scope'] as (typeof FEED_SCOPES)[number]) : 'everyone';
    const scopePost = scope === 'following' ? ` AND (p.author_id = ? OR p.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))` : '';
    const scopeBlog = scope === 'following' ? ` AND (b.author_id = ? OR b.author_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))` : '';
    const scopeParams = scope === 'following' ? [me, me] : [];
    const posts = all<PostRow>(
      db,
      `${POST_SELECT}${scopePost}${before ? ' AND p.created_at < ?' : ''} ORDER BY p.created_at DESC LIMIT 20`,
      me,
      ...scopeParams,
      ...(before ? [before] : []),
    );
    const blogs = all<BlogRow>(
      db,
      `${BLOG_SELECT} AND b.status = 'published'${scopeBlog}${before ? ' AND b.published_at < ?' : ''} ORDER BY b.published_at DESC LIMIT 20`,
      me,
      ...scopeParams,
      ...(before ? [before] : []),
    );
    // Public books with something in them show up as their own kind of item.
    const scopeBook = scope === 'following' ? ` AND (k.owner_id = ? OR k.owner_id IN (SELECT followee_id FROM follows WHERE follower_id = ?))` : '';
    const books = all<Parameters<typeof toBook>[1]>(
      db,
      `${BOOK_SELECT} AND k.visibility = 'public'${scopeBook}${before ? ' AND k.created_at < ?' : ''}
       AND EXISTS(SELECT 1 FROM recipe_book_items i WHERE i.book_id = k.id) ORDER BY k.created_at DESC LIMIT 20`,
      ...scopeParams,
      ...(before ? [before] : []),
    );
    const items: FeedItem[] = [
      ...posts.map((x): FeedItem => ({ type: 'post', createdAt: x.created_at, post: toPost(db, x, me) })),
      ...blogs.map((x): FeedItem => ({ type: 'blog', createdAt: x.published_at ?? x.created_at, blog: toBlogPost(db, x, me) })),
      ...books.map((x): FeedItem => ({ type: 'book', createdAt: x.created_at, book: toBook(db, x, me) })),
    ]
      .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, 20);
    const exhausted = posts.length < 20 && blogs.length < 20 && books.length < 20;
    const nextBefore = !exhausted && items.length === 20 ? items[items.length - 1]!.createdAt : null;
    // Paid placements: up to three per page, clearly labelled, never counted against the page.
    const promos = items.length ? commerce.pickForFeed(Math.min(3, Math.ceil(items.length / 6))) : [];
    promos.forEach((promotion, i) => {
      const at = Math.min(items.length, 2 + i * 7);
      items.splice(at, 0, { type: 'promo', createdAt: items[at]?.createdAt ?? promotion.createdAt, promotion });
    });
    res.json({ items, nextBefore });
  });

  /** People worth following: most followed / most active you don't follow yet. */
  r.get('/suggestions', (req, res) => {
    const me = req.user!.id;
    const rows = all<{ id: string; handle: string; display_name: string | null; avatar_emoji: string; bio: string; followers: number; activity: number }>(
      db,
      `SELECT u.id, u.handle, u.display_name, u.avatar_emoji, u.bio,
              (SELECT COUNT(*) FROM follows f WHERE f.followee_id = u.id) AS followers,
              (SELECT COUNT(*) FROM posts p WHERE p.author_id = u.id) + (SELECT COUNT(*) FROM blog_posts b WHERE b.author_id = u.id AND b.status = 'published') AS activity
       FROM users u
       WHERE u.disabled_at IS NULL AND u.id != ? AND u.id NOT IN (SELECT followee_id FROM follows WHERE follower_id = ?)
       ORDER BY followers DESC, activity DESC, u.created_at ASC LIMIT 6`,
      me,
      me,
    );
    const people: Person[] = rows.map((u) => ({ id: u.id, handle: u.handle, displayName: u.display_name ?? u.handle, avatar: u.avatar_emoji, bio: u.bio, followerCount: u.followers, followedByMe: false, isMe: false }));
    res.json({ people });
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
    if (media.some((m) => !m || m.owner_id !== me || m.post_id || m.blog_id)) throw badRequest('One of the attached files is not yours or is already used.');
    tx(db, () => {
      run(db, `INSERT INTO posts (id, author_id, recipe_id, caption, created_at) VALUES (?, ?, ?, ?, ?)`, id, me, body.recipeId, body.caption, now());
      // Sharing makes the recipe readable by other signed-in people.
      run(db, `UPDATE recipes SET visibility = 'public', updated_at = ? WHERE id = ?`, now(), body.recipeId);
      media.forEach((m, i) => run(db, 'UPDATE media SET post_id = ?, position = ? WHERE id = ?', id, i, m!.id));
    });
    notifier.sendToFollowers(me, 'post', { postId: id });
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
    const target = one<{ author_id: string }>(db, 'SELECT author_id FROM posts WHERE id = ?', req.params['id']);
    if (!target) throw notFound('That post is gone.');
    if (liked) {
      run(db, 'INSERT OR IGNORE INTO likes (post_id, user_id, created_at) VALUES (?, ?, ?)', req.params['id'], me, now());
      notifier.send(target.author_id, 'like', { actorId: me, postId: req.params['id']! });
    } else run(db, 'DELETE FROM likes WHERE post_id = ? AND user_id = ?', req.params['id'], me);
    const count = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM likes WHERE post_id = ?', req.params['id'])!.n;
    res.json({ liked, likeCount: count });
  });

  r.post('/posts/:id/comments', (req, res) => {
    const me = req.user!.id;
    const body = parse(CreateCommentSchema, req.body);
    const target = one<{ author_id: string; is_system: number }>(db, 'SELECT p.author_id, u.is_system FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?', req.params['id']);
    if (!target) throw notFound('That post is gone.');
    if (target.is_system) throw forbidden('Comments are off on house recipes. Like it, save it, or adapt it instead.');
    const id = newId('cmt');
    run(db, `INSERT INTO comments (id, post_id, author_id, body, created_at) VALUES (?, ?, ?, ?, ?)`, id, req.params['id'], me, body.body, now());
    notifier.send(target.author_id, 'comment', { actorId: me, postId: req.params['id']!, commentId: id });
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
    const n = (sql: string, ...params: unknown[]) => one<{ n: number }>(db, sql, ...params)!.n;
    const postCount = n('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?', u.id);
    const likeCount =
      n('SELECT COUNT(*) AS n FROM likes l JOIN posts p ON p.id = l.post_id WHERE p.author_id = ?', u.id) +
      n('SELECT COUNT(*) AS n FROM blog_likes l JOIN blog_posts b ON b.id = l.blog_id WHERE b.author_id = ?', u.id);
    return {
      id: u.id,
      handle: u.handle,
      displayName: u.display_name ?? u.handle,
      avatar: u.avatar_emoji,
      bio: u.bio,
      createdAt: u.created_at,
      postCount,
      likeCount,
      followerCount: n('SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?', u.id),
      followingCount: n('SELECT COUNT(*) AS n FROM follows WHERE follower_id = ?', u.id),
      blogCount: u.id === me ? n('SELECT COUNT(*) AS n FROM blog_posts WHERE author_id = ?', u.id) : n(`SELECT COUNT(*) AS n FROM blog_posts WHERE author_id = ? AND status = 'published'`, u.id),
      bookCount: u.id === me ? n('SELECT COUNT(*) AS n FROM recipe_books WHERE owner_id = ?', u.id) : n(`SELECT COUNT(*) AS n FROM recipe_books WHERE owner_id = ? AND visibility = 'public'`, u.id),
      isMe: u.id === me,
      followedByMe: Boolean(one(db, 'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', me, u.id)),
      followsMe: Boolean(one(db, 'SELECT 1 FROM follows WHERE follower_id = ? AND followee_id = ?', u.id, me)),
    };
  }

  r.get('/profiles/:handle', (req, res) => {
    const me = req.user!.id;
    const profile = publicProfile(req.params['handle']!.toLowerCase(), me);
    const rows = all<PostRow>(db, `${POST_SELECT} AND p.author_id = ? ORDER BY p.created_at DESC LIMIT 50`, me, profile.id);
    const blogs = all<BlogRow>(
      db,
      `${BLOG_SELECT} AND b.author_id = ?${profile.isMe ? '' : ` AND b.status = 'published'`} ORDER BY COALESCE(b.published_at, b.created_at) DESC LIMIT 50`,
      me,
      profile.id,
    );
    res.json({ profile, posts: rows.map((x) => toPost(db, x, me)), blogs: blogs.map((x) => toBlogPost(db, x, me)), books: booksFor(db, profile.id, me) });
  });

  // ---- following --------------------------------------------------------------------------
  function personRows(sql: string, me: string, ...params: unknown[]): Person[] {
    return all<{ id: string; handle: string; display_name: string | null; avatar_emoji: string; bio: string; followers: number; followed: number }>(db, sql, me, ...params).map((u) => ({
      id: u.id,
      handle: u.handle,
      displayName: u.display_name ?? u.handle,
      avatar: u.avatar_emoji,
      bio: u.bio,
      followerCount: u.followers,
      followedByMe: Boolean(u.followed),
      isMe: u.id === me,
    }));
  }
  const PERSON = `SELECT u.id, u.handle, u.display_name, u.avatar_emoji, u.bio,
      (SELECT COUNT(*) FROM follows f2 WHERE f2.followee_id = u.id) AS followers,
      EXISTS(SELECT 1 FROM follows f3 WHERE f3.follower_id = ? AND f3.followee_id = u.id) AS followed
    FROM follows f JOIN users u ON u.id = `;

  r.post('/follow/:handle', (req, res) => {
    const me = req.user!.id;
    const follow = parse(z.object({ follow: z.boolean() }), req.body).follow;
    const target = one<{ id: string }>(db, 'SELECT id FROM users WHERE handle = ? AND disabled_at IS NULL', req.params['handle']!.toLowerCase());
    if (!target) throw notFound('No one goes by that handle.');
    if (target.id === me) throw badRequest('You can’t follow yourself.');
    if (follow) {
      run(db, 'INSERT OR IGNORE INTO follows (follower_id, followee_id, created_at) VALUES (?, ?, ?)', me, target.id, now());
      notifier.send(target.id, 'follow', { actorId: me });
    } else run(db, 'DELETE FROM follows WHERE follower_id = ? AND followee_id = ?', me, target.id);
    const followerCount = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM follows WHERE followee_id = ?', target.id)!.n;
    res.json({ following: follow, followerCount });
  });

  /** Posts this person liked. Private to them, like TikTok's Liked tab. */
  r.get('/profiles/:handle/likes', (req, res) => {
    const me = req.user!.id;
    const profile = publicProfile(req.params['handle']!.toLowerCase(), me);
    if (!profile.isMe) throw forbidden('Liked posts are private.');
    const rows = all<PostRow>(db, `${POST_SELECT} AND p.id IN (SELECT post_id FROM likes WHERE user_id = ?) ORDER BY (SELECT created_at FROM likes l WHERE l.post_id = p.id AND l.user_id = ?) DESC LIMIT 60`, me, me, me);
    res.json({ posts: rows.map((x) => toPost(db, x, me)) });
  });

  r.get('/profiles/:handle/followers', (req, res) => {
    const me = req.user!.id;
    const profile = publicProfile(req.params['handle']!.toLowerCase(), me);
    res.json({ people: personRows(`${PERSON} f.follower_id WHERE f.followee_id = ? AND u.disabled_at IS NULL ORDER BY f.created_at DESC LIMIT 200`, me, profile.id) });
  });
  r.get('/profiles/:handle/following', (req, res) => {
    const me = req.user!.id;
    const profile = publicProfile(req.params['handle']!.toLowerCase(), me);
    res.json({ people: personRows(`${PERSON} f.followee_id WHERE f.follower_id = ? AND u.disabled_at IS NULL ORDER BY f.created_at DESC LIMIT 200`, me, profile.id) });
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
