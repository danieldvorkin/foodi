import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router';
import type { Notification } from '@foodi/shared';
import { notifications as api, recipes as recipesApi } from '../api/types';
import { timeAgo } from '../lib/format';
import { isActive, seedJobs, upsertJob } from '../lib/jobs';
import { useToast } from './Toast';
import { Avatar } from './ui';

export const KIND_EMOJI: Record<Notification['kind'], string> = { like: '❤️', comment: '💬', save: '⭐', role: '🛠', system: '📣', follow: '👋', book: '📚', remix: '🍴', post: '🆕', sale: '💵', promo: '🚀', payout: '🏦', listing: '🛍️', order: '📦', recipe: '✨' };

export function describe(n: Notification): { text: string; to: string | null } {
  const who = n.actor?.displayName ?? 'Someone';
  const recipe = n.recipeTitle ? `“${n.recipeTitle}”` : 'your recipe';
  const blog = n.blogTitle ? `“${n.blogTitle}”` : 'your post';
  const postTo = n.postId ? `/app/posts/${n.postId}` : null;
  const blogTo = n.blogId ? `/app/blog/${n.blogId}` : null;
  switch (n.kind) {
    case 'like':
      return n.blogId ? { text: `${who} liked ${blog}`, to: blogTo } : { text: `${who} liked your post about ${recipe}`, to: postTo };
    case 'comment':
      return n.blogId ? { text: `${who} commented on ${blog}`, to: blogTo } : { text: `${who} commented on ${recipe}`, to: postTo };
    case 'save':
      return { text: `${who} saved ${recipe} to their recipes`, to: n.recipeId ? `/app/recipes/${n.recipeId}` : null };
    case 'follow':
      return { text: `${who} started following you`, to: n.actor ? `/app/u/${n.actor.handle}` : null };
    case 'book':
      return { text: `${who} added ${recipe} to their book ${n.bookName ? `“${n.bookName}”` : ''}`.trim(), to: n.bookId ? `/app/books/${n.bookId}` : null };
    case 'remix':
      return { text: `${who} adapted ${recipe} — their version will credit you`, to: n.recipeId ? `/app/recipes/${n.recipeId}` : null };
    case 'post':
      return n.blogId ? { text: `${who} published ${blog}`, to: blogTo } : { text: `${who} shared ${recipe}`, to: postTo };
    case 'sale':
      return { text: `${who} ${n.message ?? 'bought one of your books'}`, to: '/app/sales' };
    case 'promo':
      return { text: n.message ?? 'Your promotion is live', to: n.bookId ? `/app/books/${n.bookId}` : '/app/sales' };
    case 'payout':
      return { text: n.message ?? 'Payout update', to: '/app/sales' };
    case 'listing':
      return { text: n.message ?? 'Listing update', to: '/app/shop/mine' };
    case 'order':
      return { text: `${who} ${n.message ?? 'placed an order'}`, to: '/app/shop/mine' };
    case 'recipe':
      return { text: n.message ?? 'Your recipe is ready', to: n.recipeId ? `/app/recipes/${n.recipeId}` : '/app/cook' };
    case 'role':
      return { text: n.message ?? 'Your role changed', to: '/app/settings?tab=account' };
    default:
      return { text: n.message ?? 'Notice', to: null };
  }
}

/**
 * Unread count shared by the bell and the notifications page. Opens one live stream per tab
 * and falls back to polling every 30s if the stream can't connect.
 */
export function useUnread(onNotification?: (n: Notification) => void) {
  const [unread, setUnread] = useState(0);
  const [latest, setLatest] = useState<Notification | null>(null);
  const toast = useToast();
  const handler = useRef(onNotification);
  useEffect(() => {
    handler.current = onNotification;
  });
  useEffect(() => {
    let alive = true;
    let poll: number | null = null;
    const refresh = () => api.unread().then((r) => alive && setUnread(r.unread)).catch(() => {});
    refresh();
    // Background recipe jobs: anything still in flight from an earlier visit, then live updates.
    recipesApi
      .jobs(true)
      .then((r) => alive && seedJobs(r.jobs))
      .catch(() => {});
    const startPolling = () => {
      if (poll !== null) return;
      poll = window.setInterval(() => document.visibilityState === 'visible' && refresh(), 30_000);
    };
    const stop = api.stream(
      (ev) => {
        if (!alive) return;
        setUnread(ev.unread);
        if (ev.notification) {
          setLatest(ev.notification);
          handler.current?.(ev.notification);
        }
      },
      () => startPolling(),
      (job) => {
        if (!alive) return;
        const prev = upsertJob(job);
        if (prev && isActive(prev) && job.status === 'done') toast(`Your recipe is ready: “${job.recipeTitle ?? 'open Cook to see it'}”`);
        if (prev && isActive(prev) && job.status === 'failed') toast(`Couldn’t write “${job.prompt}”: ${job.lastError ?? 'unknown error'}`, 'error');
      },
    );
    const onVisible = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      alive = false;
      stop();
      if (poll !== null) window.clearInterval(poll);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [toast]);
  return { unread, setUnread, latest };
}

export function NotificationRow({ n, onOpen, onRead }: { n: Notification; onOpen?: () => void; onRead?: (id: string) => void }) {
  const d = describe(n);
  const inner = (
    <>
      {n.actor ? <Avatar name={n.actor.displayName} emoji={n.actor.avatar} /> : <span className="avatar avatar-emoji">{KIND_EMOJI[n.kind]}</span>}
      <div className="grow" style={{ minWidth: 0 }}>
        <p className="small">
          <span aria-hidden="true">{KIND_EMOJI[n.kind]} </span>
          {d.text}
        </p>
        <p className="muted tiny">{timeAgo(n.createdAt)}</p>
      </div>
      {!n.readAt && <span className="dot-unread" aria-label="Unread" />}
    </>
  );
  return (
    <li className={n.readAt ? '' : 'is-unread'}>
      {d.to ? (
        <Link
          to={d.to}
          className="panel-item"
          onClick={() => {
            if (!n.readAt) onRead?.(n.id);
            onOpen?.();
          }}
        >
          {inner}
        </Link>
      ) : (
        <div className="panel-item">{inner}</div>
      )}
    </li>
  );
}

/** Bell + dropdown. The count is live (state owned by the layout); the list loads when the panel opens. */
export function NotificationBell({ unread, setUnread, latest }: { unread: number; setUnread: (n: number) => void; latest: Notification | null }) {
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const [pulse, setPulse] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // A new one arrived: put it on top of an open list and nudge the bell. Keyed on the id so it runs once per notification.
  const [seenId, setSeenId] = useState<string | null>(null);
  if (latest && latest.id !== seenId) {
    setSeenId(latest.id);
    setItems((xs) => (xs && !xs.some((x) => x.id === latest.id) ? [latest, ...xs] : xs));
    setPulse(true);
  }
  useEffect(() => {
    if (!pulse) return;
    const t = window.setTimeout(() => setPulse(false), 900);
    return () => window.clearTimeout(t);
  }, [pulse]);

  useEffect(() => {
    if (!open) return;
    api.list().then((r) => {
      setItems(r.notifications);
      setUnread(r.unread);
    });
    const onDoc = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open, setUnread]);

  async function markAll() {
    const r = await api.markRead();
    setUnread(r.unread);
    setItems((xs) => xs?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
  }
  async function markOne(id: string) {
    const r = await api.markRead([id]);
    setUnread(r.unread);
    setItems((xs) => xs?.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)) ?? null);
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button type="button" className={`iconbtn bell${pulse ? ' is-pulsing' : ''}`} aria-haspopup="dialog" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        <span aria-hidden="true">🔔</span>
        {unread > 0 && <span className="bell-badge num">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="panel panel-right" role="dialog" aria-label="Notifications">
          <div className="panel-head">
            <h3>Notifications</h3>
            <div className="row" style={{ gap: 4 }}>
              {unread > 0 && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={markAll}>
                  Mark all read
                </button>
              )}
              <Link to="/app/notifications" className="btn btn-quiet btn-sm" onClick={() => setOpen(false)}>
                See all
              </Link>
            </div>
          </div>
          {items === null ? (
            <p className="muted small" style={{ padding: 'var(--s-4)' }}>
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="muted small" style={{ padding: 'var(--s-4)' }}>
              🍃 Nothing yet. Likes, comments, new followers and people adapting your recipes show up here.
            </p>
          ) : (
            <ul className="panel-list">
              {items.slice(0, 12).map((n) => (
                <NotificationRow key={n.id} n={n} onOpen={() => setOpen(false)} onRead={markOne} />
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
