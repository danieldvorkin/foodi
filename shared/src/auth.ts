import { z } from 'zod';

export const ROLES = ['admin', 'consumer'] as const;
export type Role = (typeof ROLES)[number];

/** Which AI vendor a credential belongs to. */
export const VENDORS = ['openai', 'anthropic', 'mock'] as const;
export type Vendor = (typeof VENDORS)[number];

export const AuthProviderInfoSchema = z.object({
  id: z.string(),
  vendor: z.enum(VENDORS),
  label: z.string(),
  /** 'oauth' starts a browser redirect; 'api_key' shows the key form. */
  kind: z.enum(['oauth', 'api_key']),
  /** Shown under the button, e.g. why Claude is key-based. */
  note: z.string().nullable(),
});
export type AuthProviderInfo = z.infer<typeof AuthProviderInfoSchema>;

export const MeSchema = z.object({
  id: z.string(),
  role: z.enum(ROLES),
  displayName: z.string().nullable(),
  email: z.string().nullable(),
  avatar: z.string(),
  handle: z.string(),
  /** How this person signs in: 'password', or SSO provider ids. */
  signInMethods: z.array(z.string()),
  /** The AI account used to write recipes, if one is connected. */
  vendor: z.enum(VENDORS).nullable(),
  /** 'managed' is a key foodi made for this person on its own OpenAI organisation. */
  credentialKind: z.enum(['oauth', 'api_key', 'managed']).nullable(),
  /** Last characters of a connected API key, so people can tell keys apart. */
  credentialHint: z.string().nullable(),
  credentialUpdatedAt: z.string().nullable(),
  /** When foodi provides the AI: the daily allowance and what's used, so the UI can say so. */
  managed: z.object({ limitPerDay: z.number(), usedToday: z.number(), images: z.boolean() }).nullable(),
  /** foodi can hand this person a key on request (admin key configured, feature on, none connected yet). */
  managedAvailable: z.boolean(),
  hasProfile: z.boolean(),
  /** Granular admin rights (see ADMIN_PERMISSIONS). Empty for consumers. */
  permissions: z.array(z.string()),
  /** Generate a photo for each AI-written recipe (only possible when the connected vendor can). */
  autoPhotos: z.boolean(),
  /** What the connected vendor can do, so the UI can hide what it can't. */
  aiCapabilities: z.object({ images: z.boolean(), vision: z.boolean() }),
  createdAt: z.string(),
});

const email = z.string().trim().toLowerCase().email().max(254);

export const RegisterSchema = z.object({
  email,
  password: z.string().min(10).max(200),
  displayName: z.string().trim().min(1).max(40),
});
export const LoginSchema = z.object({ email, password: z.string().min(1).max(200) });
/** Change a password, or set one for an account that only has SSO (then `email` is required). */
export const ChangePasswordSchema = z.object({
  current: z.string().max(200).optional(),
  next: z.string().min(10).max(200),
  email: email.optional(),
});
export type Me = z.infer<typeof MeSchema>;

export const ConnectKeyRequestSchema = z.object({
  vendor: z.enum(['openai', 'anthropic']),
  apiKey: z.string().trim().min(20).max(400),
});
export type ConnectKeyRequest = z.infer<typeof ConnectKeyRequestSchema>;
