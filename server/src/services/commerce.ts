import { CURRENCY, PROMO_PACKAGES, type Earnings, type Payout, type PromoPackageId, type Promotion, type Purchase } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { addMs, days, now } from '../lib/time.js';
import type { PaymentProvider } from '../payments/types.js';
import type { Notifier } from './notify.js';
import type { Settings } from './settings.js';

interface PurchaseRow {
  id: string;
  buyer_id: string;
  buyer_handle: string;
  buyer_name: string | null;
  buyer_avatar: string;
  seller_id: string;
  seller_handle: string;
  seller_name: string | null;
  seller_avatar: string;
  book_id: string | null;
  book_name: string;
  book_emoji: string;
  amount_cents: number;
  platform_fee_cents: number;
  currency: string;
  provider: 'stripe' | 'test';
  provider_ref: string | null;
  status: Purchase['status'];
  created_at: string;
  paid_at: string | null;
}
const PURCHASE_SELECT = `
  SELECT p.*, b.handle AS buyer_handle, b.display_name AS buyer_name, b.avatar_emoji AS buyer_avatar,
         s.handle AS seller_handle, s.display_name AS seller_name, s.avatar_emoji AS seller_avatar
  FROM purchases p JOIN users b ON b.id = p.buyer_id JOIN users s ON s.id = p.seller_id`;

interface PromotionRow {
  id: string;
  book_id: string;
  owner_id: string;
  package_id: PromoPackageId;
  amount_cents: number;
  currency: string;
  provider: 'stripe' | 'test';
  provider_ref: string | null;
  status: Promotion['status'];
  starts_at: string | null;
  ends_at: string | null;
  impressions: number;
  clicks: number;
  created_at: string;
  book_name: string;
  book_emoji: string;
  book_description: string;
  book_price: number;
  book_for_sale: number;
  book_recipes: number;
  owner_handle: string;
  owner_name: string | null;
  owner_avatar: string;
}
const PROMOTION_SELECT = `
  SELECT pr.*, k.name AS book_name, k.emoji AS book_emoji, k.description AS book_description, k.price_cents AS book_price, k.for_sale AS book_for_sale,
         (SELECT COUNT(*) FROM recipe_book_items i WHERE i.book_id = k.id) AS book_recipes,
         u.handle AS owner_handle, u.display_name AS owner_name, u.avatar_emoji AS owner_avatar
  FROM promotions pr JOIN recipe_books k ON k.id = pr.book_id JOIN users u ON u.id = pr.owner_id`;

interface PayoutRow {
  id: string;
  user_id: string;
  handle: string;
  display_name: string | null;
  avatar_emoji: string;
  amount_cents: number;
  status: Payout['status'];
  note: string;
  created_at: string;
  resolved_at: string | null;
}
const PAYOUT_SELECT = `SELECT p.*, u.handle, u.display_name, u.avatar_emoji FROM payouts p JOIN users u ON u.id = p.user_id`;

export function toPurchase(x: PurchaseRow): Purchase {
  return {
    id: x.id,
    book: { id: x.book_id, name: x.book_name, emoji: x.book_emoji },
    buyer: { id: x.buyer_id, handle: x.buyer_handle, displayName: x.buyer_name ?? x.buyer_handle, avatar: x.buyer_avatar },
    seller: { id: x.seller_id, handle: x.seller_handle, displayName: x.seller_name ?? x.seller_handle, avatar: x.seller_avatar },
    amountCents: x.amount_cents,
    platformFeeCents: x.platform_fee_cents,
    currency: x.currency,
    provider: x.provider,
    status: x.status,
    createdAt: x.created_at,
    paidAt: x.paid_at,
  };
}
export function toPromotion(x: PromotionRow): Promotion {
  const pkg = PROMO_PACKAGES.find((p) => p.id === x.package_id);
  return {
    id: x.id,
    book: {
      id: x.book_id,
      name: x.book_name,
      emoji: x.book_emoji,
      description: x.book_description,
      priceCents: x.book_price,
      forSale: Boolean(x.book_for_sale),
      recipeCount: x.book_recipes,
      owner: { id: x.owner_id, handle: x.owner_handle, displayName: x.owner_name ?? x.owner_handle, avatar: x.owner_avatar },
    },
    packageId: x.package_id,
    packageName: pkg?.name ?? x.package_id,
    amountCents: x.amount_cents,
    provider: x.provider,
    status: x.status,
    startsAt: x.starts_at,
    endsAt: x.ends_at,
    impressions: x.impressions,
    clicks: x.clicks,
    createdAt: x.created_at,
  };
}
export function toPayout(x: PayoutRow): Payout {
  return {
    id: x.id,
    user: { id: x.user_id, handle: x.handle, displayName: x.display_name ?? x.handle, avatar: x.avatar_emoji },
    amountCents: x.amount_cents,
    status: x.status,
    note: x.note,
    createdAt: x.created_at,
    resolvedAt: x.resolved_at,
  };
}

interface Deps {
  db: Db;
  settings: Settings;
  notifier: Notifier;
  provider: PaymentProvider;
  appOrigin: string;
  log: Logger;
}

/** Selling books, buying promotions, tracking earnings and payouts. Money moves through `provider`. */
export function createCommerce({ db, settings, notifier, provider, appOrigin, log }: Deps) {
  const n = (sql: string, ...params: unknown[]) => one<{ n: number }>(db, sql, ...params)!.n;

  function bookRow(id: string) {
    return one<{ id: string; owner_id: string; name: string; emoji: string; visibility: string; for_sale: number; price_cents: number }>(
      db,
      'SELECT id, owner_id, name, emoji, visibility, for_sale, price_cents FROM recipe_books WHERE id = ?',
      id,
    );
  }

  // ---- checkout ---------------------------------------------------------------------------
  async function startBookPurchase(buyer: { id: string; email: string | null }, bookId: string): Promise<{ url: string }> {
    if (!settings.get().paymentsEnabled) throw forbidden('Buying books is turned off right now.');
    const book = bookRow(bookId);
    if (!book || book.visibility !== 'public') throw notFound('That book is gone, or private.');
    if (!book.for_sale || book.price_cents <= 0) throw badRequest('That book is not for sale.');
    if (book.owner_id === buyer.id) throw badRequest('It’s your own book.');
    if (one(db, `SELECT 1 FROM purchases WHERE buyer_id = ? AND book_id = ? AND status = 'paid'`, buyer.id, bookId)) throw conflict('You already own this book.');
    const fee = Math.round((book.price_cents * settings.get().platformFeePercent) / 100);
    const id = newId('pur');
    tx(db, () => {
      run(db, `UPDATE purchases SET status = 'cancelled' WHERE buyer_id = ? AND book_id = ? AND status = 'pending'`, buyer.id, bookId);
      run(
        db,
        `INSERT INTO purchases (id, buyer_id, seller_id, book_id, book_name, book_emoji, amount_cents, platform_fee_cents, currency, provider, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
        id,
        buyer.id,
        book.owner_id,
        book.id,
        book.name,
        book.emoji,
        book.price_cents,
        fee,
        CURRENCY,
        provider.id,
        now(),
      );
    });
    const { url, providerRef } = await provider.createCheckout({
      kind: 'book',
      refId: id,
      amountCents: book.price_cents,
      currency: CURRENCY,
      name: `${book.emoji} ${book.name}`,
      description: 'Recipe book on foodi',
      successUrl: `${appOrigin}/app/pay/done?kind=book&id=${id}`,
      cancelUrl: `${appOrigin}/app/books/${book.id}?checkout=cancelled`,
      customerEmail: buyer.email,
    });
    run(db, 'UPDATE purchases SET provider_ref = ? WHERE id = ?', providerRef, id);
    return { url };
  }

  async function startPromotion(owner: { id: string; email: string | null }, bookId: string, packageId: PromoPackageId): Promise<{ url: string }> {
    if (!settings.get().promotionsEnabled) throw forbidden('Promotions are turned off right now.');
    const pkg = PROMO_PACKAGES.find((p) => p.id === packageId);
    if (!pkg) throw badRequest('Unknown package.');
    const book = bookRow(bookId);
    if (!book || book.owner_id !== owner.id) throw notFound('That book is gone.');
    if (book.visibility !== 'public') throw badRequest('Make the book public before promoting it.');
    if (n('SELECT COUNT(*) AS n FROM recipe_book_items WHERE book_id = ?', bookId) === 0) throw badRequest('Put some recipes in the book first.');
    const id = newId('prm');
    run(
      db,
      `INSERT INTO promotions (id, book_id, owner_id, package_id, amount_cents, currency, provider, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      id,
      book.id,
      owner.id,
      pkg.id,
      pkg.priceCents,
      CURRENCY,
      provider.id,
      now(),
    );
    const { url, providerRef } = await provider.createCheckout({
      kind: 'promo',
      refId: id,
      amountCents: pkg.priceCents,
      currency: CURRENCY,
      name: `${pkg.name} — ${book.emoji} ${book.name}`,
      description: `${pkg.days} days promoted on foodi`,
      successUrl: `${appOrigin}/app/pay/done?kind=promo&id=${id}`,
      cancelUrl: `${appOrigin}/app/books/${book.id}?checkout=cancelled`,
      customerEmail: owner.email,
    });
    run(db, 'UPDATE promotions SET provider_ref = ? WHERE id = ?', providerRef, id);
    return { url };
  }

  /** Mark an order paid. Idempotent: a second call for the same id is a no-op. */
  function fulfil(kind: 'book' | 'promo', refId: string, providerRef: string | null = null): boolean {
    if (kind === 'book') {
      const p = one<PurchaseRow>(db, `${PURCHASE_SELECT} WHERE p.id = ?`, refId);
      if (!p || p.status !== 'pending') return false;
      run(db, `UPDATE purchases SET status = 'paid', paid_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ?`, now(), providerRef, refId);
      notifier.send(p.seller_id, 'sale', { actorId: p.buyer_id, bookId: p.book_id, message: `bought “${p.book_name}”` });
      log.info({ purchase: refId, amountCents: p.amount_cents }, 'book sold');
      return true;
    }
    const pr = one<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.id = ?`, refId);
    if (!pr || pr.status !== 'pending') return false;
    const pkg = PROMO_PACKAGES.find((x) => x.id === pr.package_id)!;
    const t = now();
    run(db, `UPDATE promotions SET status = 'active', starts_at = ?, ends_at = ?, provider_ref = COALESCE(?, provider_ref) WHERE id = ?`, t, addMs(days(pkg.days)), providerRef, refId);
    notifier.send(pr.owner_id, 'promo', { bookId: pr.book_id, message: `“${pr.book_name}” is now promoted for ${pkg.days} days.` });
    log.info({ promotion: refId, package: pkg.id }, 'promotion started');
    return true;
  }

  function cancelPending(kind: 'book' | 'promo', refId: string, userId: string) {
    if (kind === 'book') run(db, `UPDATE purchases SET status = 'cancelled' WHERE id = ? AND buyer_id = ? AND status = 'pending'`, refId, userId);
    else run(db, `UPDATE promotions SET status = 'cancelled' WHERE id = ? AND owner_id = ? AND status = 'pending'`, refId, userId);
  }

  /** What the test checkout page needs to show. Only the payer may look. */
  function pendingOrder(kind: 'book' | 'promo', refId: string, userId: string): { name: string; amountCents: number; currency: string; status: string; returnTo: string } {
    if (kind === 'book') {
      const p = one<PurchaseRow>(db, `${PURCHASE_SELECT} WHERE p.id = ? AND p.buyer_id = ?`, refId, userId);
      if (!p) throw notFound('No such order.');
      return { name: `${p.book_emoji} ${p.book_name}`, amountCents: p.amount_cents, currency: p.currency, status: p.status, returnTo: p.book_id ? `/app/books/${p.book_id}` : '/app/books' };
    }
    const pr = one<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.id = ? AND pr.owner_id = ?`, refId, userId);
    if (!pr) throw notFound('No such order.');
    const pkg = PROMO_PACKAGES.find((x) => x.id === pr.package_id)!;
    return { name: `${pkg.name} for ${pr.book_emoji} ${pr.book_name}`, amountCents: pr.amount_cents, currency: pr.currency, status: pr.status, returnTo: `/app/books/${pr.book_id}` };
  }

  // ---- promotions in the feed ------------------------------------------------------------------
  function expire() {
    run(db, `UPDATE promotions SET status = 'expired' WHERE status = 'active' AND ends_at < ?`, now());
  }
  function activePromotions(): Promotion[] {
    expire();
    return all<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.status = 'active' AND k.visibility = 'public' AND u.disabled_at IS NULL ORDER BY pr.created_at DESC`).map(toPromotion);
  }
  /** Pick up to `count` distinct promotions, weighted by package, for one page of the feed. */
  function pickForFeed(count: number): Promotion[] {
    const pool = activePromotions();
    const out: Promotion[] = [];
    while (pool.length && out.length < count) {
      const total = pool.reduce((a, p) => a + (PROMO_PACKAGES.find((x) => x.id === p.packageId)?.weight ?? 1), 0);
      let r = Math.random() * total;
      let idx = 0;
      for (; idx < pool.length; idx++) {
        r -= PROMO_PACKAGES.find((x) => x.id === pool[idx]!.packageId)?.weight ?? 1;
        if (r <= 0) break;
      }
      out.push(pool.splice(Math.min(idx, pool.length - 1), 1)[0]!);
    }
    if (out.length) tx(db, () => out.forEach((p) => run(db, 'UPDATE promotions SET impressions = impressions + 1 WHERE id = ?', p.id)));
    return out;
  }
  /** Featured rail: strongest packages first, newest within a package. */
  function featured(limit = 3): Promotion[] {
    const weight = (p: Promotion) => PROMO_PACKAGES.find((x) => x.id === p.packageId)?.weight ?? 1;
    return activePromotions()
      .sort((a, b) => weight(b) - weight(a) || (a.createdAt < b.createdAt ? 1 : -1))
      .slice(0, limit);
  }
  function recordClick(id: string) {
    run(db, `UPDATE promotions SET clicks = clicks + 1 WHERE id = ? AND status = 'active'`, id);
  }

  // ---- earnings & payouts ----------------------------------------------------------------------
  function earnings(userId: string): Earnings {
    const purchases = all<PurchaseRow>(db, `${PURCHASE_SELECT} WHERE p.seller_id = ? AND p.status IN ('paid','refunded') ORDER BY p.created_at DESC LIMIT 200`, userId).map(toPurchase);
    const paid = purchases.filter((p) => p.status === 'paid');
    const grossCents = paid.reduce((a, p) => a + p.amountCents, 0);
    const feesCents = paid.reduce((a, p) => a + p.platformFeeCents, 0);
    const netCents = grossCents - feesCents;
    const paidOutCents = n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payouts WHERE user_id = ? AND status = 'paid'`, userId);
    const requestedCents = n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payouts WHERE user_id = ? AND status = 'requested'`, userId);
    const promotions = all<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.owner_id = ? AND pr.status != 'pending' ORDER BY pr.created_at DESC LIMIT 100`, userId).map(toPromotion);
    const spentOnPromotionsCents = promotions.filter((p) => p.status !== 'cancelled' && p.status !== 'refunded').reduce((a, p) => a + p.amountCents, 0);
    return {
      salesCount: paid.length,
      grossCents,
      feesCents,
      netCents,
      paidOutCents,
      requestedCents,
      availableCents: Math.max(0, netCents - paidOutCents - requestedCents),
      spentOnPromotionsCents,
      purchases,
      promotions,
      payouts: all<PayoutRow>(db, `${PAYOUT_SELECT} WHERE p.user_id = ? ORDER BY p.created_at DESC LIMIT 100`, userId).map(toPayout),
    };
  }

  function requestPayout(userId: string): Payout {
    const e = earnings(userId);
    if (e.payouts.some((p) => p.status === 'requested')) throw conflict('You already have a payout request waiting.');
    if (e.availableCents <= 0) throw badRequest('Nothing to pay out yet.');
    const id = newId('pay');
    run(db, `INSERT INTO payouts (id, user_id, amount_cents, status, note, created_at) VALUES (?, ?, ?, 'requested', '', ?)`, id, userId, e.availableCents, now());
    return toPayout(one<PayoutRow>(db, `${PAYOUT_SELECT} WHERE p.id = ?`, id)!);
  }

  // ---- admin -----------------------------------------------------------------------------------
  function adminOverview() {
    expire();
    return {
      stats: {
        salesGrossCents: n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM purchases WHERE status = 'paid'`),
        platformFeesCents: n(`SELECT COALESCE(SUM(platform_fee_cents), 0) AS n FROM purchases WHERE status = 'paid'`),
        promotionRevenueCents: n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM promotions WHERE status IN ('active','expired')`),
        purchases: n(`SELECT COUNT(*) AS n FROM purchases WHERE status = 'paid'`),
        refunds: n(`SELECT COUNT(*) AS n FROM purchases WHERE status = 'refunded'`),
        activePromotions: n(`SELECT COUNT(*) AS n FROM promotions WHERE status = 'active'`),
        pendingPayouts: n(`SELECT COUNT(*) AS n FROM payouts WHERE status = 'requested'`),
        pendingPayoutCents: n(`SELECT COALESCE(SUM(amount_cents), 0) AS n FROM payouts WHERE status = 'requested'`),
        booksForSale: n(`SELECT COUNT(*) AS n FROM recipe_books WHERE for_sale = 1 AND visibility = 'public'`),
      },
      provider: { id: provider.id, webhookConfigured: provider.id !== 'stripe' || Boolean(process.env['STRIPE_WEBHOOK_SECRET']) },
      purchases: all<PurchaseRow>(db, `${PURCHASE_SELECT} WHERE p.status != 'pending' ORDER BY p.created_at DESC LIMIT 200`).map(toPurchase),
      promotions: all<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.status != 'pending' ORDER BY pr.created_at DESC LIMIT 200`).map(toPromotion),
      payouts: all<PayoutRow>(db, `${PAYOUT_SELECT} ORDER BY CASE p.status WHEN 'requested' THEN 0 ELSE 1 END, p.created_at DESC LIMIT 200`).map(toPayout),
    };
  }

  async function refund(purchaseId: string) {
    const p = one<PurchaseRow>(db, `${PURCHASE_SELECT} WHERE p.id = ?`, purchaseId);
    if (!p) throw notFound('No such purchase.');
    if (p.status !== 'paid') throw badRequest('Only paid purchases can be refunded.');
    if (p.provider_ref) await provider.refund(p.provider_ref);
    run(db, `UPDATE purchases SET status = 'refunded', refunded_at = ? WHERE id = ?`, now(), purchaseId);
    notifier.send(p.buyer_id, 'system', { message: `Your purchase of “${p.book_name}” was refunded. Access to the book has been removed.` });
    notifier.send(p.seller_id, 'system', { message: `A sale of “${p.book_name}” was refunded by an admin.` });
  }

  function cancelPromotion(id: string) {
    const pr = one<PromotionRow>(db, `${PROMOTION_SELECT} WHERE pr.id = ?`, id);
    if (!pr) throw notFound('No such promotion.');
    run(db, `UPDATE promotions SET status = 'cancelled' WHERE id = ? AND status IN ('active','pending')`, id);
    notifier.send(pr.owner_id, 'system', { message: `The promotion for “${pr.book_name}” was stopped by an admin.` });
  }

  function resolvePayout(id: string, status: 'paid' | 'rejected', note: string, adminId: string) {
    const p = one<PayoutRow>(db, `${PAYOUT_SELECT} WHERE p.id = ?`, id);
    if (!p) throw notFound('No such payout.');
    if (p.status !== 'requested') throw badRequest('That payout was already handled.');
    run(db, `UPDATE payouts SET status = ?, note = ?, resolved_at = ?, resolved_by = ? WHERE id = ?`, status, note, now(), adminId, id);
    notifier.send(p.user_id, 'payout', { message: status === 'paid' ? `Your payout was sent.${note ? ` ${note}` : ''}` : `Your payout request was declined.${note ? ` ${note}` : ''}` });
  }

  return { startBookPurchase, startPromotion, fulfil, cancelPending, pendingOrder, activePromotions, pickForFeed, featured, recordClick, earnings, requestPayout, adminOverview, refund, cancelPromotion, resolvePayout, expire, providerId: provider.id };
}
export type Commerce = ReturnType<typeof createCommerce>;
