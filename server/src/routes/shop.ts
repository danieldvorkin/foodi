import { Router } from 'express';
import { z } from 'zod';
import { BuyListingSchema, ReviewListingSchema, SHOP_CATEGORIES, UpsertListingSchema, type Listing } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import type { Audit } from '../services/audit.js';
import { ORDER_SELECT, toOrder, type Commerce, type OrderRow } from '../services/commerce.js';
import type { Notifier } from '../services/notify.js';
import type { Permissions } from '../services/permissions.js';
import type { Settings } from '../services/settings.js';
import { toMediaItem, type MediaRow } from './media.js';

interface ListingRow {
  id: string;
  seller_id: string;
  seller_handle: string;
  seller_name: string | null;
  seller_avatar: string;
  title: string;
  description: string;
  category: Listing['category'];
  condition: Listing['condition'];
  price_cents: number;
  currency: string;
  quantity: number | null;
  ships_from: string;
  status: Listing['status'];
  rejection_reason: string | null;
  reviewed_at: string | null;
  submitted_at: string | null;
  created_at: string;
  updated_at: string;
  sold_count: number;
}

export const LISTING_SELECT = `
  SELECT l.*, u.handle AS seller_handle, u.display_name AS seller_name, u.avatar_emoji AS seller_avatar,
         (SELECT COALESCE(SUM(o.quantity), 0) FROM shop_orders o WHERE o.listing_id = l.id AND o.status IN ('paid','fulfilled')) AS sold_count
  FROM shop_listings l JOIN users u ON u.id = l.seller_id
  WHERE u.disabled_at IS NULL`;

export function toListing(db: Db, x: ListingRow, me: string): Listing {
  const media = all<MediaRow>(db, 'SELECT * FROM media WHERE listing_id = ? ORDER BY position, created_at', x.id).map(toMediaItem);
  return {
    id: x.id,
    title: x.title,
    description: x.description,
    category: x.category,
    condition: x.condition,
    priceCents: x.price_cents,
    currency: x.currency,
    quantity: x.quantity,
    shipsFrom: x.ships_from,
    seller: { id: x.seller_id, handle: x.seller_handle, displayName: x.seller_name ?? x.seller_handle, avatar: x.seller_avatar },
    media,
    cover: media.find((m) => m.kind === 'image') ?? null,
    status: x.status,
    rejectionReason: x.rejection_reason,
    soldCount: x.sold_count,
    isMine: x.seller_id === me,
    submittedAt: x.submitted_at,
    reviewedAt: x.reviewed_at,
    createdAt: x.created_at,
    updatedAt: x.updated_at,
  };
}

export function shopRoutes(db: Db, commerce: Commerce, settings: Settings, notifier: Notifier) {
  const r = Router();
  r.use(requireAuth);

  /** The shop front: approved listings, newest approval first. */
  r.get('/', (req, res) => {
    const me = req.user!.id;
    const category = typeof req.query['category'] === 'string' && (SHOP_CATEGORIES as readonly string[]).includes(req.query['category']) ? req.query['category'] : null;
    const q = typeof req.query['q'] === 'string' ? req.query['q'].trim().slice(0, 80) : '';
    const before = typeof req.query['before'] === 'string' ? req.query['before'] : null;
    const params: unknown[] = [];
    let where = ` AND l.status = 'approved'`;
    if (category) {
      where += ' AND l.category = ?';
      params.push(category);
    }
    if (q) {
      where += ' AND (l.title LIKE ? OR l.description LIKE ?)';
      params.push(`%${q}%`, `%${q}%`);
    }
    if (before) {
      where += ' AND l.reviewed_at < ?';
      params.push(before);
    }
    const rows = all<ListingRow>(db, `${LISTING_SELECT}${where} ORDER BY l.reviewed_at DESC LIMIT 24`, ...params);
    res.json({ listings: rows.map((x) => toListing(db, x, me)), nextBefore: rows.length === 24 ? rows[rows.length - 1]!.reviewed_at : null });
  });

  /** A few recent approvals for the feed rail. */
  r.get('/latest', (req, res) => {
    const rows = all<ListingRow>(db, `${LISTING_SELECT} AND l.status = 'approved' ORDER BY l.reviewed_at DESC LIMIT 4`);
    res.json({ listings: rows.map((x) => toListing(db, x, req.user!.id)) });
  });

  r.get('/mine', (req, res) => {
    const me = req.user!.id;
    const rows = all<ListingRow>(db, `${LISTING_SELECT} AND l.seller_id = ? ORDER BY l.updated_at DESC LIMIT 100`, me);
    res.json({ listings: rows.map((x) => toListing(db, x, me)) });
  });

  /** Orders as a buyer or a seller. */
  r.get('/orders', (req, res) => {
    const me = req.user!.id;
    const role = req.query['role'] === 'selling' ? 'selling' : 'buying';
    const rows = all<OrderRow>(db, `${ORDER_SELECT} WHERE ${role === 'selling' ? 'o.seller_id' : 'o.buyer_id'} = ? AND o.status != 'pending' ORDER BY o.created_at DESC LIMIT 200`, me);
    res.json({ orders: rows.map(toOrder) });
  });

  r.post('/orders/:id/fulfil', (req, res) => {
    const me = req.user!.id;
    const o = one<OrderRow>(db, `${ORDER_SELECT} WHERE o.id = ? AND o.seller_id = ?`, req.params['id'], me);
    if (!o) throw notFound('No such order.');
    if (o.status !== 'paid') throw badRequest('Only paid orders can be marked as sent.');
    run(db, `UPDATE shop_orders SET status = 'fulfilled', fulfilled_at = ? WHERE id = ?`, now(), o.id);
    notifier.send(o.buyer_id, 'order', { actorId: me, message: `sent your order of “${o.listing_title}”.` });
    res.json({ ok: true });
  });

  function attachMedia(id: string, me: string, mediaIds: string[]) {
    const media = mediaIds.map((mid) => one<MediaRow & { listing_id: string | null }>(db, 'SELECT * FROM media WHERE id = ?', mid));
    if (media.some((m) => !m || m.owner_id !== me || m.post_id || m.recipe_id || m.blog_id || (m.listing_id && m.listing_id !== id))) throw badRequest('One of the photos is not yours or is already used.');
    run(db, 'UPDATE media SET listing_id = NULL WHERE listing_id = ?', id);
    media.forEach((m, i) => run(db, 'UPDATE media SET listing_id = ?, position = ? WHERE id = ?', id, i, m!.id));
  }

  r.post('/', (req, res) => {
    const me = req.user!.id;
    if (!settings.get().paymentsEnabled) throw forbidden('Selling is turned off right now.');
    const body = parse(UpsertListingSchema, req.body);
    const recent = one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM shop_listings WHERE seller_id = ? AND created_at > ?`, me, new Date(Date.now() - 3600_000).toISOString());
    if ((recent?.n ?? 0) >= 10) throw conflict('That’s a lot of listings in an hour. Take a break and try again later.');
    if (body.submit && body.mediaIds.length === 0) throw badRequest('Add at least one photo before submitting for review.');
    const id = newId('lst');
    const t = now();
    tx(db, () => {
      run(
        db,
        `INSERT INTO shop_listings (id, seller_id, title, description, category, condition, price_cents, currency, quantity, ships_from, status, submitted_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'usd', ?, ?, ?, ?, ?, ?)`,
        id,
        me,
        body.title,
        body.description,
        body.category,
        body.condition,
        body.priceCents,
        body.quantity,
        body.shipsFrom,
        body.submit ? 'pending' : 'draft',
        body.submit ? t : null,
        t,
        t,
      );
      attachMedia(id, me, body.mediaIds);
    });
    res.status(201).json({ listing: toListing(db, one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ?`, id)!, me) });
  });

  r.get('/:id', (req, res) => {
    const me = req.user!;
    const row = one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ?`, req.params['id']);
    if (!row) throw notFound('That listing is gone.');
    const visible = row.status === 'approved' || row.status === 'sold_out' || row.seller_id === me.id || me.role === 'admin';
    if (!visible) throw notFound('That listing is gone.');
    res.json({ listing: toListing(db, row, me.id) });
  });

  /** Edits go back through review, so an approved listing can't quietly turn into something else. */
  r.put('/:id', (req, res) => {
    const me = req.user!.id;
    const row = one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ? AND l.seller_id = ?`, req.params['id'], me);
    if (!row) throw notFound('That listing is gone.');
    const body = parse(UpsertListingSchema, req.body);
    if (body.submit && body.mediaIds.length === 0) throw badRequest('Add at least one photo before submitting for review.');
    const t = now();
    tx(db, () => {
      run(
        db,
        `UPDATE shop_listings SET title = ?, description = ?, category = ?, condition = ?, price_cents = ?, quantity = ?, ships_from = ?,
           status = ?, submitted_at = ?, rejection_reason = NULL, reviewed_by = NULL, reviewed_at = NULL, updated_at = ? WHERE id = ?`,
        body.title,
        body.description,
        body.category,
        body.condition,
        body.priceCents,
        body.quantity,
        body.shipsFrom,
        body.submit ? 'pending' : 'draft',
        body.submit ? t : null,
        t,
        row.id,
      );
      attachMedia(row.id, me, body.mediaIds);
    });
    res.json({ listing: toListing(db, one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ?`, row.id)!, me) });
  });

  r.post('/:id/archive', (req, res) => {
    const me = req.user!.id;
    const row = one<{ id: string }>(db, 'SELECT id FROM shop_listings WHERE id = ? AND seller_id = ?', req.params['id'], me);
    if (!row) throw notFound('That listing is gone.');
    run(db, `UPDATE shop_listings SET status = 'archived', updated_at = ? WHERE id = ?`, now(), row.id);
    res.json({ ok: true });
  });

  r.delete('/:id', (req, res) => {
    const me = req.user!;
    const row = one<{ id: string; seller_id: string }>(db, 'SELECT id, seller_id FROM shop_listings WHERE id = ?', req.params['id']);
    if (!row) throw notFound('That listing is gone.');
    if (row.seller_id !== me.id && me.role !== 'admin') throw forbidden('Only the seller can delete this.');
    if (one(db, `SELECT 1 FROM shop_orders WHERE listing_id = ? AND status IN ('paid')`, row.id)) throw conflict('There are paid orders waiting to be sent. Fulfil them first, then archive the listing.');
    run(db, 'DELETE FROM shop_listings WHERE id = ?', row.id);
    res.json({ ok: true });
  });

  r.post('/:id/buy', async (req, res, next) => {
    try {
      const body = parse(BuyListingSchema, req.body ?? {});
      res.json(await commerce.startOrder({ id: req.user!.id, email: req.user!.email }, req.params['id']!, body.quantity, body.note));
    } catch (e) {
      next(e);
    }
  });

  return r;
}

/** Review queue and moderation. Approvals need the "posting-approvals" permission; takedowns need only the admin role. */
export function adminShopRoutes(db: Db, permissions: Permissions, notifier: Notifier, audit: Audit) {
  const r = Router();
  r.use(requireAuth, requireRole('admin'));

  r.get('/', (req, res) => {
    const status = typeof req.query['status'] === 'string' ? req.query['status'] : null;
    const rows = status
      ? all<ListingRow>(db, `${LISTING_SELECT} AND l.status = ? ORDER BY COALESCE(l.submitted_at, l.updated_at) ASC LIMIT 200`, status)
      : all<ListingRow>(db, `${LISTING_SELECT} ORDER BY CASE l.status WHEN 'pending' THEN 0 ELSE 1 END, l.updated_at DESC LIMIT 200`);
    res.json({
      listings: rows.map((x) => toListing(db, x, req.user!.id)),
      canApprove: permissions.has(req.user, 'posting-approvals'),
      pending: one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM shop_listings WHERE status = 'pending'`)!.n,
    });
  });

  r.post('/:id/review', permissions.require('posting-approvals'), (req, res) => {
    const body = parse(ReviewListingSchema, req.body);
    const row = one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ?`, req.params['id']);
    if (!row) throw notFound('No such listing.');
    if (row.status !== 'pending') throw badRequest('Only pending listings can be reviewed.');
    if (body.decision === 'reject' && !body.reason) throw badRequest('Give the seller a reason.');
    run(
      db,
      `UPDATE shop_listings SET status = ?, rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`,
      body.decision === 'approve' ? 'approved' : 'rejected',
      body.decision === 'reject' ? body.reason : null,
      req.user!.id,
      now(),
      now(),
      row.id,
    );
    notifier.send(row.seller_id, 'listing', {
      message: body.decision === 'approve' ? `“${row.title}” was approved and is live in the Shop.` : `“${row.title}” wasn’t approved: ${body.reason}`,
    });
    audit.record(req.user!.id, `listing.${body.decision}`, 'listing', row.id, { seller: row.seller_id, reason: body.reason });
    res.json({ ok: true });
  });

  /** Pull a live listing. Any admin. */
  r.post('/:id/takedown', (req, res) => {
    const body = parse(z.object({ reason: z.string().trim().min(1).max(500) }), req.body);
    const row = one<ListingRow>(db, `${LISTING_SELECT} AND l.id = ?`, req.params['id']);
    if (!row) throw notFound('No such listing.');
    run(db, `UPDATE shop_listings SET status = 'rejected', rejection_reason = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ? WHERE id = ?`, body.reason, req.user!.id, now(), now(), row.id);
    notifier.send(row.seller_id, 'listing', { message: `“${row.title}” was taken down: ${body.reason}` });
    audit.record(req.user!.id, 'listing.takedown', 'listing', row.id, { seller: row.seller_id, reason: body.reason });
    res.json({ ok: true });
  });

  return r;
}
