import { z } from 'zod';

/** Everything is priced in whole cents of one currency. */
export const CURRENCY = 'usd';
export const MIN_BOOK_PRICE_CENTS = 99;
export const MAX_BOOK_PRICE_CENTS = 49_900;

/** Promotion packages a seller can buy for a book. Weight = how often it's picked for a feed slot. */
export const PROMO_PACKAGES = [
  { id: 'boost-3', name: 'Boost', days: 3, priceCents: 499, weight: 1, blurb: 'Your book in the feed for three days.' },
  { id: 'feature-7', name: 'Featured week', days: 7, priceCents: 1499, weight: 2, blurb: 'A week in the feed and in the “Featured books” rail.' },
  { id: 'spotlight-30', name: 'Spotlight month', days: 30, priceCents: 3999, weight: 4, blurb: 'Thirty days everywhere, first in the rail.' },
] as const;
export type PromoPackageId = (typeof PROMO_PACKAGES)[number]['id'];
export const PROMO_PACKAGE_IDS = PROMO_PACKAGES.map((p) => p.id) as [PromoPackageId, ...PromoPackageId[]];

export const PAYMENT_PROVIDERS = ['stripe', 'test'] as const;
export const PURCHASE_STATUS = ['pending', 'paid', 'refunded', 'cancelled'] as const;
export const PROMOTION_STATUS = ['pending', 'active', 'expired', 'cancelled', 'refunded'] as const;
export const PAYOUT_STATUS = ['requested', 'paid', 'rejected'] as const;

const Person = z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() });
const BookRef = z.object({ id: z.string().nullable(), name: z.string(), emoji: z.string() });

export const SellBookSchema = z.object({
  forSale: z.boolean(),
  priceCents: z.number().int().min(MIN_BOOK_PRICE_CENTS).max(MAX_BOOK_PRICE_CENTS),
  salesPitch: z.string().trim().max(600).default(''),
  /** How many recipes a non-buyer can open before paying. */
  previewCount: z.number().int().min(0).max(10).default(2),
});

export const PurchaseSchema = z.object({
  id: z.string(),
  book: BookRef,
  buyer: Person,
  seller: Person,
  amountCents: z.number(),
  platformFeeCents: z.number(),
  currency: z.string(),
  provider: z.enum(PAYMENT_PROVIDERS),
  status: z.enum(PURCHASE_STATUS),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
});
export type Purchase = z.infer<typeof PurchaseSchema>;

export const PromotionSchema = z.object({
  id: z.string(),
  book: BookRef.extend({ owner: Person, recipeCount: z.number(), priceCents: z.number(), forSale: z.boolean(), description: z.string() }),
  packageId: z.enum(PROMO_PACKAGE_IDS),
  packageName: z.string(),
  amountCents: z.number(),
  provider: z.enum(PAYMENT_PROVIDERS),
  status: z.enum(PROMOTION_STATUS),
  startsAt: z.string().nullable(),
  endsAt: z.string().nullable(),
  impressions: z.number(),
  clicks: z.number(),
  createdAt: z.string(),
});
export type Promotion = z.infer<typeof PromotionSchema>;

export const PayoutSchema = z.object({
  id: z.string(),
  user: Person,
  amountCents: z.number(),
  status: z.enum(PAYOUT_STATUS),
  note: z.string(),
  createdAt: z.string(),
  resolvedAt: z.string().nullable(),
});
export type Payout = z.infer<typeof PayoutSchema>;

export const EarningsSchema = z.object({
  salesCount: z.number(),
  grossCents: z.number(),
  feesCents: z.number(),
  netCents: z.number(),
  paidOutCents: z.number(),
  requestedCents: z.number(),
  availableCents: z.number(),
  spentOnPromotionsCents: z.number(),
  purchases: z.array(PurchaseSchema),
  promotions: z.array(PromotionSchema),
  payouts: z.array(PayoutSchema),
});
export type Earnings = z.infer<typeof EarningsSchema>;

export const CommerceConfigSchema = z.object({
  paymentsEnabled: z.boolean(),
  promotionsEnabled: z.boolean(),
  /** True when no real payment provider is configured: checkouts complete on a fake page and no money moves. */
  testMode: z.boolean(),
  platformFeePercent: z.number(),
  currency: z.string(),
  packages: z.array(z.object({ id: z.enum(PROMO_PACKAGE_IDS), name: z.string(), days: z.number(), priceCents: z.number(), blurb: z.string() })),
  minPriceCents: z.number(),
  maxPriceCents: z.number(),
});
export type CommerceConfig = z.infer<typeof CommerceConfigSchema>;

export const AdminCommerceSchema = z.object({
  stats: z.object({
    salesGrossCents: z.number(),
    platformFeesCents: z.number(),
    promotionRevenueCents: z.number(),
    purchases: z.number(),
    refunds: z.number(),
    activePromotions: z.number(),
    pendingPayouts: z.number(),
    pendingPayoutCents: z.number(),
    booksForSale: z.number(),
  }),
  provider: z.object({ id: z.enum(PAYMENT_PROVIDERS), webhookConfigured: z.boolean() }),
  purchases: z.array(PurchaseSchema),
  promotions: z.array(PromotionSchema),
  payouts: z.array(PayoutSchema),
});
export type AdminCommerce = z.infer<typeof AdminCommerceSchema>;

export function formatMoney(cents: number, currency = CURRENCY): string {
  return new Intl.NumberFormat(undefined, { style: 'currency', currency: currency.toUpperCase(), minimumFractionDigits: cents % 100 === 0 ? 0 : 2 }).format(cents / 100);
}
