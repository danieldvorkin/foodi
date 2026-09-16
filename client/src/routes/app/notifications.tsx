import { useEffect, useState } from 'react';
import { useLoaderData } from 'react-router';
import type { Notification } from '@foodi/shared';
import { notifications as api } from '../../api/types';
import { NotificationRow, useUnread } from '../../components/Notifications';
import { Empty } from '../../components/ui';

export async function notificationsLoader() {
  return api.list();
}

export function NotificationsPage() {
  const data = useLoaderData<typeof notificationsLoader>();
  const [items, setItems] = useState<Notification[]>(data.notifications);
  const { latest, setUnread } = useUnread();
  useEffect(() => setItems(data.notifications), [data]);
  useEffect(() => {
    if (latest) setItems((xs) => (xs.some((x) => x.id === latest.id) ? xs : [latest, ...xs]));
  }, [latest]);
  const unread = items.filter((n) => !n.readAt).length;

  async function markAll() {
    const r = await api.markRead();
    setUnread(r.unread);
    setItems((xs) => xs.map((n) => ({ ...n, readAt: n.readAt ?? new Date().toISOString() })));
  }
  async function markOne(id: string) {
    const r = await api.markRead([id]);
    setUnread(r.unread);
    setItems((xs) => xs.map((n) => (n.id === id ? { ...n, readAt: n.readAt ?? new Date().toISOString() } : n)));
  }
  async function clearRead() {
    const r = await api.clearRead();
    setItems(r.notifications);
    setUnread(r.unread);
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 680 }}>
      <header className="row-between">
        <div>
          <h1>🔔 Notifications</h1>
          <p className="muted">{unread ? `${unread} unread` : 'You’re all caught up.'}</p>
        </div>
        <div className="row">
          {unread > 0 && (
            <button type="button" className="btn btn-sm" onClick={markAll}>
              Mark all read
            </button>
          )}
          {items.some((n) => n.readAt) && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={clearRead}>
              Clear read
            </button>
          )}
        </div>
      </header>
      {items.length === 0 ? (
        <Empty title="🍃 Nothing yet">Likes, comments, new followers, and people adapting or shelving your recipes show up here as they happen.</Empty>
      ) : (
        <ul className="panel-list panel-list-page">
          {items.map((n) => (
            <NotificationRow key={n.id} n={n} onRead={markOne} />
          ))}
        </ul>
      )}
    </main>
  );
}
