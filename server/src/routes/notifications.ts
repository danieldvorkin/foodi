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
  r.post('/read', (req, res) => {
    const body = parse(z.object({ ids: z.array(z.string().min(1)).max(100).optional() }), req.body ?? {});
    notifier.markRead(req.user!.id, body.ids ?? 'all');
    res.json({ unread: notifier.unreadCount(req.user!.id) });
  });
  r.delete('/:id', (req, res) => {
    notifier.remove(req.user!.id, req.params['id']!);
    res.json({ ok: true });
  });
  return r;
}
