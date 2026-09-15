import { useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { Notification } from '@foodi/shared';
import { notifications as api } from '../api/types';
import { timeAgo } from '../lib/format';
import { Avatar } from './ui';

const KIND_EMOJI: Record<Notification['kind'], string> = { like: '❤️', comment: '💬', save: '⭐', role: '🛠', system: '📣' };

function describe(n: Notification): { text: string; to: string | null } {
  const who = n.actor?.displayName ?? 'Someone';
  const what = n.recipeTitle ? `“${n.recipeTitle}”` : 'your recipe';
  switch (n.kind) {
    case 'like':
      return { text: `${who} liked your post about ${what}`, to: n.postId ? `/app/posts/${n.postId}` : null };
    case 'comment':
      return { text: `${who} commented on ${what}`, to: n.postId ? `/app/posts/${n.postId}` : null };
    case 'save':
      return { text: `${who} saved ${what} to their recipes`, to: n.recipeId ? `/app/recipes/${n.recipeId}` : null };
    case 'role':
      return { text: n.message ?? 'Your role changed', to: '/app/settings?tab=account' };
    default:
      return { text: n.message ?? 'Notice', to: null };
  }
}

/** Bell + panel. Polls the unread count while the tab is visible; loads the list on open. */
export function NotificationBell() {
  const [unread, setUnread] = useState(0);
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState<Notification[] | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      api.unread().then((r) => alive && setUnread(r.unread)).catch(() => {});
    };
    tick();
    const t = window.setInterval(tick, 30_000);
    document.addEventListener('visibilitychange', tick);
    return () => {
      alive = false;
      window.clearInterval(t);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [location.pathname]);

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
  }, [open]);

  async function markAll() {
    const r = await api.markRead();
    setUnread(r.unread);
    setItems((xs) => xs?.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })) ?? null);
  }

  return (
    <div className="bell-wrap" ref={wrap}>
      <button type="button" className="navlink bell" aria-haspopup="dialog" aria-expanded={open} aria-label={`Notifications${unread ? `, ${unread} unread` : ''}`} onClick={() => setOpen((o) => !o)}>
        🔔
        {unread > 0 && <span className="bell-badge num">{unread > 99 ? '99+' : unread}</span>}
      </button>
      {open && (
        <div className="panel" role="dialog" aria-label="Notifications">
          <div className="panel-head">
            <h3>Notifications</h3>
            {unread > 0 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={markAll}>
                Mark all read
              </button>
            )}
          </div>
          {items === null ? (
            <p className="muted small" style={{ padding: 'var(--s-4)' }}>
              Loading…
            </p>
          ) : items.length === 0 ? (
            <p className="muted small" style={{ padding: 'var(--s-4)' }}>
              🍃 Nothing yet. When someone likes, comments on or saves what you share, it shows up here.
            </p>
          ) : (
            <ul className="panel-list">
              {items.map((n) => {
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
                  <li key={n.id} className={n.readAt ? '' : 'is-unread'}>
                    {d.to ? (
                      <Link
                        to={d.to}
                        className="panel-item"
                        onClick={() => {
                          if (!n.readAt) void api.markRead([n.id]).then((r) => setUnread(r.unread));
                          setOpen(false);
                        }}
                      >
                        {inner}
                      </Link>
                    ) : (
                      <div className="panel-item">{inner}</div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
