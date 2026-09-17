import { z } from 'zod';
import { ROLES, VENDORS } from './auth.js';

export const AdminUserSchema = z.object({
  id: z.string(),
  role: z.enum(ROLES),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  vendor: z.enum(VENDORS).nullable(),
  credentialKind: z.enum(['oauth', 'api_key']).nullable(),
  disabledAt: z.string().nullable(),
  createdAt: z.string(),
  lastSeenAt: z.string().nullable(),
  recipeCount: z.number(),
  generationCount: z.number(),
  activeSessions: z.number(),
});
export type AdminUser = z.infer<typeof AdminUserSchema>;

export const AdminStatsSchema = z.object({
  users: z.number(),
  admins: z.number(),
  disabledUsers: z.number(),
  recipes: z.number(),
  posts: z.number(),
  blogPosts: z.number(),
  books: z.number(),
  follows: z.number(),
  mediaCount: z.number(),
  mediaBytes: z.number(),
  generations7d: z.number(),
  failures7d: z.number(),
  medianLatencyMs7d: z.number().nullable(),
  /** 14 daily buckets, oldest first. */
  generationsByDay: z.array(z.object({ day: z.string(), ok: z.number(), failed: z.number() })),
  byVendor: z.array(z.object({ vendor: z.string(), count: z.number() })),
});
export type AdminStats = z.infer<typeof AdminStatsSchema>;

export const GenerationLogSchema = z.object({
  id: z.string(),
  userId: z.string(),
  userDisplayName: z.string().nullable(),
  vendor: z.string(),
  model: z.string(),
  status: z.enum(['ok', 'failed']),
  latencyMs: z.number(),
  inputTokens: z.number().nullable(),
  outputTokens: z.number().nullable(),
  errorCode: z.string().nullable(),
  recipeId: z.string().nullable(),
  createdAt: z.string(),
});
export type GenerationLog = z.infer<typeof GenerationLogSchema>;

export const AuditEntrySchema = z.object({
  id: z.string(),
  actorId: z.string(),
  actorDisplayName: z.string().nullable(),
  action: z.string(),
  targetType: z.string(),
  targetId: z.string().nullable(),
  detail: z.string().nullable(),
  createdAt: z.string(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;

export const AppSettingsSchema = z.object({
  allowSignups: z.boolean(),
  maintenanceMessage: z.string().max(300),
  maxGenerationsPerUserPerDay: z.number().int().min(0).max(10000),
  /** Per-person upload cap in megabytes. 0 = uploads off. */
  maxUploadMbPerUser: z.number().int().min(0).max(100000),
  /** How often the house kitchen (@foodi) shares one of its recipes to the feed. 0 = never. */
  housePostsPerDay: z.number().int().min(0).max(24),
  /** Selling recipe books and buying promotions. Off hides every buy button. */
  paymentsEnabled: z.boolean(),
  promotionsEnabled: z.boolean(),
  /** foodi's cut of each book sale, in percent. */
  platformFeePercent: z.number().int().min(0).max(50),
});
export type AppSettings = z.infer<typeof AppSettingsSchema>;

export const AdminUpdateUserSchema = z.object({
  role: z.enum(ROLES).optional(),
  disabled: z.boolean().optional(),
});

export const AdminNotifySchema = z.object({
  message: z.string().trim().min(1).max(300),
  userId: z.string().min(1).optional(),
});
