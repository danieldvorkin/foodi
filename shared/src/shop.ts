import { z } from 'zod';
import { MediaItemSchema } from './recipe.js';
import { PAYMENT_PROVIDERS } from './commerce.js';

/** Granular admin rights beyond the base role. An admin without a permission sees no button and gets a 403. */
export const ADMIN_PERMISSIONS = [
  { id: 'posting-approvals', name: 'Listing approvals', blurb: 'Approve or reject Shop listings before they go live.' },
] as const;
export type AdminPermission = (typeof ADMIN_PERMISSIONS)[number]['id'];
export const ADMIN_PERMISSION_IDS = ADMIN_PERMISSIONS.map((p) => p.id) as [AdminPermission, ...AdminPermission[]];

export const SHOP_CATEGORIES = ['cookware', 'ingredients', 'books', 'classes', 'services', 'other'] as const;
export const SHOP_CATEGORY_EMOJI: Record<(typeof SHOP_CATEGORIES)[number], string> = {
  cookware: '🍳',
  ingredients: '🫙',
  books: '📕',
  classes: '🎓',
  services: '🧑‍🍳',
  other: '🎁',
};
export const SHOP_CONDITIONS = ['new', 'used'] as const;
export const LISTING_STATUS = ['draft', 'pending', 'approved', 'rejected', 'sold_out', 'archived'] as const;
export const ORDER_STATUS = ['pending', 'paid', 'fulfilled', 'refunded', 'cancelled'] as const;

const Person = z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() });

export const ListingSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Light markdown, same renderer as the blog. */
  description: z.string(),
  category: z.enum(SHOP_CATEGORIES),
  condition: z.enum(SHOP_CONDITIONS).nullable(),
  priceCents: z.number(),
  currency: z.string(),
  /** null = unlimited (services, digital goods). */
  quantity: z.number().nullable(),
  shipsFrom: z.string(),
  seller: Person,
  media: z.array(MediaItemSchema),
  cover: MediaItemSchema.nullable(),
  status: z.enum(LISTING_STATUS),
  rejectionReason: z.string().nullable(),
  soldCount: z.number(),
  isMine: z.boolean(),
  submittedAt: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Listing = z.infer<typeof ListingSchema>;

export const UpsertListingSchema = z.object({
  title: z.string().trim().min(3, 'Give it a title').max(100),
  description: z.string().trim().min(10, 'Say a little more').max(5000),
  category: z.enum(SHOP_CATEGORIES),
  condition: z.enum(SHOP_CONDITIONS).nullable().default(null),
  priceCents: z.number().int().min(100).max(1_000_000),
  quantity: z.number().int().min(1).max(10_000).nullable().default(null),
  shipsFrom: z.string().trim().max(80).default(''),
  mediaIds: z.array(z.string().min(1)).max(8).default([]),
  /** true = submit for review; false = keep as a draft. */
  submit: z.boolean().default(true),
});

export const OrderSchema = z.object({
  id: z.string(),
  listing: z.object({ id: z.string().nullable(), title: z.string(), category: z.enum(SHOP_CATEGORIES) }),
  buyer: Person,
  seller: Person,
  quantity: z.number(),
  amountCents: z.number(),
  platformFeeCents: z.number(),
  currency: z.string(),
  note: z.string(),
  provider: z.enum(PAYMENT_PROVIDERS),
  status: z.enum(ORDER_STATUS),
  createdAt: z.string(),
  paidAt: z.string().nullable(),
  fulfilledAt: z.string().nullable(),
});
export type Order = z.infer<typeof OrderSchema>;

export const BuyListingSchema = z.object({
  quantity: z.number().int().min(1).max(50).default(1),
  /** Delivery details or a message for the seller; shown to the seller only. */
  note: z.string().trim().max(500).default(''),
});

export const ReviewListingSchema = z.object({
  decision: z.enum(['approve', 'reject']),
  reason: z.string().trim().max(500).default(''),
});
