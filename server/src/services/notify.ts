import type { Notification } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { now } from '../lib/time.js';

type Kind = Notification['kind'];

interface Row {
  id: string;
  kind: Kind;
  actor_id: string | null;
  actor_handle: string | null;
  actor_name: string | null;
  actor_avatar: string | null;
  post_id: string | null;
  recipe_id: string | null;
  recipe_title: string | null;
  blog_id: string | null;
  blog_title: string | null;
  book_id: string | null;
  book_name: string | null;
  message: string | null;
  read_at: string | null;
  created_at: string;
}

export interface NotifyRefs {
  actorId?: string | null;
  postId?: string | null;
  recipeId?: string | null;
  commentId?: string | null;
  blogId?: string | null;
  bookId?: string | null;
  message?: string | null;
}

/** A live event pushed to a person's open tabs. */
export interface NotifyEvent {
  unread: number;
  /** Present when a new notification was just created (not on mark-read). */
  notification?: Notification;
}
type Listener = (ev: NotifyEvent) => void;

export function createNotifier(db: Db) {
  // In-process fan-out to open SSE streams. One process, one map; fine for a local app.
  const listeners = new Map<string, Set<Listener>>();

  function emit(userId: string, ev: NotifyEvent) {
    const set = listeners.get(userId);
    if (!set) return;
    for (const fn of set) {
      try {
        fn(ev);
      } catch {
        /* a dead stream; it cleans itself up on close */
      }
    }
  }

  function subscribe(userId: string, fn: Listener): () => void {
    let set = listeners.get(userId);
    if (!set) listeners.set(userId, (set = new Set()));
    set.add(fn);
    return () => {
      set!.delete(fn);
      if (set!.size === 0) listeners.delete(userId);
    };
  }

  function send(userId: string, kind: Kind, refs: NotifyRefs) {
    // Never notify people about their own actions.
    if (refs.actorId && refs.actorId === userId) return;
    // One "like"/"follow" per actor per target; doing it again after undoing does not re-notify.
    if (kind === 'like' && one(db, 'SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND actor_id = ? AND post_id IS ? AND blog_id IS ?', userId, kind, refs.actorId ?? null, refs.postId ?? null, refs.blogId ?? null)) return;
    if (kind === 'follow' && one(db, 'SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND actor_id = ?', userId, kind, refs.actorId ?? null)) return;
    if (kind === 'book' && one(db, 'SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND actor_id = ? AND recipe_id IS ? AND book_id IS ?', userId, kind, refs.actorId ?? null, refs.recipeId ?? null, refs.bookId ?? null)) return;
    const id = newId('ntf');
    run(
      db,
      `INSERT INTO notifications (id, user_id, kind, actor_id, post_id, recipe_id, comment_id, blog_id, book_id, message, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      id,
      userId,
      kind,
      refs.actorId ?? null,
      refs.postId ?? null,
      refs.recipeId ?? null,
      refs.commentId ?? null,
      refs.blogId ?? null,
      refs.bookId ?? null,
      refs.message ?? null,
      now(),
    );
    if (listeners.has(userId)) {
      const fresh = list(userId, 1).notifications[0];
      emit(userId, { unread: unreadCount(userId), ...(fresh && fresh.id === id ? { notification: fresh } : {}) });
    }
  }

  /** Tell everyone who follows `authorId` about something new. */
  function sendToFollowers(authorId: string, kind: Kind, refs: NotifyRefs) {
    const followers = all<{ follower_id: string }>(db, 'SELECT follower_id FROM follows WHERE followee_id = ?', authorId);
    for (const f of followers) send(f.follower_id, kind, { ...refs, actorId: authorId });
  }

  function toNotification(x: Row): Notification {
    return {
      id: x.id,
      kind: x.kind,
      actor: x.actor_id && x.actor_handle ? { id: x.actor_id, handle: x.actor_handle, displayName: x.actor_name ?? x.actor_handle, avatar: x.actor_avatar ?? '🧑‍🍳' } : null,
      postId: x.post_id,
      recipeId: x.recipe_id,
      recipeTitle: x.recipe_title,
      blogId: x.blog_id,
      blogTitle: x.blog_title,
      bookId: x.book_id,
      bookName: x.book_name,
      message: x.message,
      readAt: x.read_at,
      createdAt: x.created_at,
    };
  }

  function list(userId: string, limit = 50): { notifications: Notification[]; unread: number } {
    const rows = all<Row>(
      db,
      `SELECT n.id, n.kind, n.actor_id, u.handle AS actor_handle, u.display_name AS actor_name, u.avatar_emoji AS actor_avatar,
              n.post_id, n.recipe_id, COALESCE(r.title, r2.title) AS recipe_title,
              n.blog_id, b.title AS blog_title, n.book_id, k.name AS book_name,
              n.message, n.read_at, n.created_at
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN recipes r ON r.id = n.recipe_id
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN recipes r2 ON r2.id = p.recipe_id
       LEFT JOIN blog_posts b ON b.id = n.blog_id
       LEFT JOIN recipe_books k ON k.id = n.book_id
       WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
      userId,
      limit,
    );
    return { unread: unreadCount(userId), notifications: rows.map(toNotification) };
  }

  function unreadCount(userId: string): number {
    return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;
  }

  function markRead(userId: string, ids: string[] | 'all') {
    const t = now();
    if (ids === 'all') run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', t, userId);
    else for (const id of ids) run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL', t, userId, id);
    emit(userId, { unread: unreadCount(userId) });
  }

  function remove(userId: string, id: string) {
    run(db, 'DELETE FROM notifications WHERE user_id = ? AND id = ?', userId, id);
    emit(userId, { unread: unreadCount(userId) });
  }

  function clearRead(userId: string) {
    run(db, 'DELETE FROM notifications WHERE user_id = ? AND read_at IS NOT NULL', userId);
  }

  return { send, sendToFollowers, subscribe, list, unreadCount, markRead, remove, clearRead };
}
export type Notifier = ReturnType<typeof createNotifier>;
