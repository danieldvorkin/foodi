import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import type { Notifier } from '../services/notify.js';

export function notificationRoutes(notifier: Notifier) {
  const r = Router();
  r.use(requireAuth);
  r.get('/', (req, res) => res.json(notifier.list(req.user!.id)));
  r.get('/unread', (req, res) => res.json({ unread: notifier.unreadCount(req.user!.id) }));

  /**
   * Live updates over Server-Sent Events. The first message carries the current unread count;
   * later ones arrive whenever something is sent to, or read by, this person. The client falls
   * back to polling if the stream can't connect.
   */
  r.get('/stream', (req, res) => {
    const userId = req.user!.id;
    res.status(200);
    res.setHeader('content-type', 'text/event-stream');
    res.setHeader('cache-control', 'no-store, no-transform');
    res.setHeader('x-accel-buffering', 'no');
    res.flushHeaders();
    const write = (event: string, data: unknown) => res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    write('unread', { unread: notifier.unreadCount(userId) });
    const off = notifier.subscribe(userId, (ev) => {
      if (ev.custom) write(ev.custom.name, ev.custom.data);
      else write(ev.notification ? 'notification' : 'unread', ev);
    });
    const beat = setInterval(() => res.write(': ping\n\n'), 25_000);
    req.on('close', () => {
      clearInterval(beat);
      off();
    });
  });

  r.post('/read', (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string().min(1)).max(100).optional() }), req.body ?? {});
    notifier.markRead(req.user!.id, body.ids ?? 'all');
    res.json({ unread: notifier.unreadCount(req.user!.id) });
  });
  r.post('/clear-read', (req, res) => {
    notifier.clearRead(req.user!.id);
    res.json(notifier.list(req.user!.id));
  });
  r.delete('/:id', (req, res) => {
    notifier.remove(req.user!.id, req.params['id']!);
    res.json({ ok: true });
  });
  return r;
}
