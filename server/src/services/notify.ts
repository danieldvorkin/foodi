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
  message: string | null;
  read_at: string | null;
  created_at: string;
}

export function createNotifier(db: Db) {
  function send(userId: string, kind: Kind, refs: { actorId?: string | null; postId?: string | null; recipeId?: string | null; commentId?: string | null; message?: string | null }) {
    // Never notify people about their own actions.
    if (refs.actorId && refs.actorId === userId) return;
    // One "like" notification per liker per post; a re-like after an unlike does not re-notify.
    if (kind === 'like' && one(db, 'SELECT 1 FROM notifications WHERE user_id = ? AND kind = ? AND actor_id = ? AND post_id = ?', userId, kind, refs.actorId ?? null, refs.postId ?? null)) return;
    run(
      db,
      `INSERT INTO notifications (id, user_id, kind, actor_id, post_id, recipe_id, comment_id, message, read_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      newId('ntf'),
      userId,
      kind,
      refs.actorId ?? null,
      refs.postId ?? null,
      refs.recipeId ?? null,
      refs.commentId ?? null,
      refs.message ?? null,
      now(),
    );
  }

  function list(userId: string, limit = 50): { notifications: Notification[]; unread: number } {
    const rows = all<Row>(
      db,
      `SELECT n.id, n.kind, n.actor_id, u.handle AS actor_handle, u.display_name AS actor_name, u.avatar_emoji AS actor_avatar,
              n.post_id, n.recipe_id, COALESCE(r.title, r2.title) AS recipe_title, n.message, n.read_at, n.created_at
       FROM notifications n
       LEFT JOIN users u ON u.id = n.actor_id
       LEFT JOIN recipes r ON r.id = n.recipe_id
       LEFT JOIN posts p ON p.id = n.post_id
       LEFT JOIN recipes r2 ON r2.id = p.recipe_id
       WHERE n.user_id = ? ORDER BY n.created_at DESC LIMIT ?`,
      userId,
      limit,
    );
    const unread = one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;
    return {
      unread,
      notifications: rows.map((x) => ({
        id: x.id,
        kind: x.kind,
        actor: x.actor_id && x.actor_handle ? { id: x.actor_id, handle: x.actor_handle, displayName: x.actor_name ?? x.actor_handle, avatar: x.actor_avatar ?? '🧑‍🍳' } : null,
        postId: x.post_id,
        recipeId: x.recipe_id,
        recipeTitle: x.recipe_title,
        message: x.message,
        readAt: x.read_at,
        createdAt: x.created_at,
      })),
    };
  }

  function unreadCount(userId: string): number {
    return one<{ n: number }>(db, 'SELECT COUNT(*) AS n FROM notifications WHERE user_id = ? AND read_at IS NULL', userId)!.n;
  }

  function markRead(userId: string, ids: string[] | 'all') {
    const t = now();
    if (ids === 'all') run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL', t, userId);
    else for (const id of ids) run(db, 'UPDATE notifications SET read_at = ? WHERE user_id = ? AND id = ? AND read_at IS NULL', t, userId, id);
  }

  function remove(userId: string, id: string) {
    run(db, 'DELETE FROM notifications WHERE user_id = ? AND id = ?', userId, id);
  }

  return { send, list, unreadCount, markRead, remove };
}
export type Notifier = ReturnType<typeof createNotifier>;
