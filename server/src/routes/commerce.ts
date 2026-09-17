import express, { Router } from 'express';
import { z } from 'zod';
import { CURRENCY, MAX_BOOK_PRICE_CENTS, MIN_BOOK_PRICE_CENTS, PROMO_PACKAGES, PROMO_PACKAGE_IDS, SellBookSchema, type CommerceConfig } from '@foodi/shared';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { badRequest, forbidden, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { now } from '../lib/time.js';
import { requireAuth, requireRole } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import { verifyStripeWebhook } from '../payments/stripe.js';
import type { Audit } from '../services/audit.js';
import type { Commerce } from '../services/commerce.js';
import type { Settings } from '../services/settings.js';

export function commerceRoutes(db: Db, commerce: Commerce, settings: Settings) {
  const r = Router();
  r.use(requireAuth);

  r.get('/config', (_req, res) => {
    const s = settings.get();
    const cfg: CommerceConfig = {
      paymentsEnabled: s.paymentsEnabled,
      promotionsEnabled: s.promotionsEnabled,
      testMode: commerce.providerId === 'test',
      platformFeePercent: s.platformFeePercent,
      currency: CURRENCY,
      packages: PROMO_PACKAGES.map((p) => ({ id: p.id, name: p.name, days: p.days, priceCents: p.priceCents, blurb: p.blurb })),
      minPriceCents: MIN_BOOK_PRICE_CENTS,
      maxPriceCents: MAX_BOOK_PRICE_CENTS,
    };
    res.json(cfg);
  });

  /** Put a book up for sale (or take it off). Every recipe in it must be the seller's own. */
  r.put('/books/:id/sale', (req, res) => {
    const me = req.user!.id;
    const book = one<{ id: string; owner_id: string; visibility: string }>(db, 'SELECT id, owner_id, visibility FROM recipe_books WHERE id = ?', req.params['id']);
    if (!book || book.owner_id !== me) throw notFound('That book is gone.');
    const body = parse(SellBookSchema, req.body);
    if (body.forSale) {
      if (!settings.get().paymentsEnabled) throw forbidden('Selling is turned off right now.');
      if (book.visibility !== 'public') throw badRequest('Make the book public first — buyers need to find it.');
      const foreign = one(db, 'SELECT 1 FROM recipe_book_items i JOIN recipes r ON r.id = i.recipe_id WHERE i.book_id = ? AND r.user_id != ?', book.id, me);
      if (foreign) throw badRequest('A book for sale can only contain your own recipes (adapted ones count as yours).');
      if (!one(db, 'SELECT 1 FROM recipe_book_items WHERE book_id = ?', book.id)) throw badRequest('Put some recipes in it first.');
    }
    run(db, 'UPDATE recipe_books SET for_sale = ?, price_cents = ?, sales_pitch = ?, preview_count = ?, updated_at = ? WHERE id = ?', body.forSale ? 1 : 0, body.priceCents, body.salesPitch, body.previewCount, now(), book.id);
    res.json({ ok: true });
  });

  r.post('/books/:id/buy', async (req, res, next) => {
    try {
      res.json(await commerce.startBookPurchase({ id: req.user!.id, email: req.user!.email }, req.params['id']!));
    } catch (e) {
      next(e);
    }
  });

  r.post('/books/:id/promote', async (req, res, next) => {
    try {
      const { packageId } = parse(z.object({ packageId: z.enum(PROMO_PACKAGE_IDS) }), req.body);
      res.json(await commerce.startPromotion({ id: req.user!.id, email: req.user!.email }, req.params['id']!, packageId));
    } catch (e) {
      next(e);
    }
  });

  r.get('/featured', (_req, res) => res.json({ promotions: commerce.featured(3) }));
  r.post('/promotions/:id/click', (req, res) => {
    commerce.recordClick(req.params['id']!);
    res.json({ ok: true });
  });

  r.get('/earnings', (req, res) => res.json(commerce.earnings(req.user!.id)));
  r.post('/payouts', (req, res) => res.status(201).json({ payout: commerce.requestPayout(req.user!.id) }));

  /** Books the person has bought. */
  r.get('/library', (req, res) => {
    const rows = all<{ book_id: string }>(db, `SELECT DISTINCT book_id FROM purchases WHERE buyer_id = ? AND status = 'paid' AND book_id IS NOT NULL`, req.user!.id);
    res.json({ bookIds: rows.map((x) => x.book_id) });
  });

  // ---- test-mode checkout (only when no real provider is configured) --------------------------
  const kindParam = z.enum(['book', 'promo', 'order']);
  r.get('/pay/test/:kind/:id', (req, res) => {
    if (commerce.providerId !== 'test') throw notFound('Test checkout is off.');
    res.json(commerce.pendingOrder(kindParam.parse(req.params['kind']), req.params['id']!, req.user!.id));
  });
  r.post('/pay/test/:kind/:id/complete', (req, res) => {
    if (commerce.providerId !== 'test') throw notFound('Test checkout is off.');
    const kind = kindParam.parse(req.params['kind']);
    const order = commerce.pendingOrder(kind, req.params['id']!, req.user!.id); // proves ownership
    commerce.fulfil(kind, req.params['id']!, `test_${req.params['id']}`);
    res.json({ ok: true, returnTo: order.returnTo });
  });
  r.post('/pay/test/:kind/:id/cancel', (req, res) => {
    if (commerce.providerId !== 'test') throw notFound('Test checkout is off.');
    const kind = kindParam.parse(req.params['kind']);
    const order = commerce.pendingOrder(kind, req.params['id']!, req.user!.id);
    commerce.cancelPending(kind, req.params['id']!, req.user!.id);
    res.json({ ok: true, returnTo: order.returnTo });
  });

  return r;
}

/**
 * Stripe calls this with a signed JSON body. Mounted on the app (not the /api router) so it
 * skips JSON parsing and the CSRF origin check — the signature is the authentication.
 */
export function stripeWebhook(config: Config, commerce: Commerce, log: Logger) {
  const r = Router();
  r.post('/', express.raw({ type: () => true, limit: '1mb' }), (req, res) => {
    const secret = config.stripe?.webhookSecret;
    if (!secret) {
      res.status(503).json({ error: { code: 'not_configured', message: 'STRIPE_WEBHOOK_SECRET is not set.' } });
      return;
    }
    const event = verifyStripeWebhook(req.body as Buffer, req.headers['stripe-signature'] as string | undefined, secret);
    if (!event) {
      res.status(400).json({ error: { code: 'bad_signature', message: 'Signature did not verify.' } });
      return;
    }
    if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
      const session = event.data.object as { id: string; payment_status?: string; metadata?: { kind?: string; refId?: string }; client_reference_id?: string };
      const kind = session.metadata?.kind;
      const refId = session.metadata?.refId ?? session.client_reference_id;
      if ((kind === 'book' || kind === 'promo' || kind === 'order') && refId && session.payment_status === 'paid') {
        const done = commerce.fulfil(kind, refId, session.id);
        log.info({ kind, refId, done }, 'stripe checkout completed');
      }
    }
    res.json({ received: true });
  });
  return r;
}

export function adminCommerceRoutes(commerce: Commerce, audit: Audit) {
  const r = Router();
  r.use(requireAuth, requireRole('admin'));
  r.get('/', (_req, res) => res.json(commerce.adminOverview()));
  r.post('/purchases/:id/refund', async (req, res, next) => {
    try {
      await commerce.refund(req.params['id']!);
      audit.record(req.user!.id, 'purchase.refund', 'purchase', req.params['id']!);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  r.post('/orders/:id/refund', async (req, res, next) => {
    try {
      await commerce.refundOrder(req.params['id']!);
      audit.record(req.user!.id, 'order.refund', 'order', req.params['id']!);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });
  r.post('/promotions/:id/cancel', (req, res) => {
    commerce.cancelPromotion(req.params['id']!);
    audit.record(req.user!.id, 'promotion.cancel', 'promotion', req.params['id']!);
    res.json({ ok: true });
  });
  r.post('/payouts/:id', (req, res) => {
    const body = parse(z.object({ status: z.enum(['paid', 'rejected']), note: z.string().trim().max(300).default('') }), req.body);
    commerce.resolvePayout(req.params['id']!, body.status, body.note, req.user!.id);
    audit.record(req.user!.id, `payout.${body.status}`, 'payout', req.params['id']!, { note: body.note });
    res.json({ ok: true });
  });
  return r;
}
