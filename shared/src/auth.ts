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
  vendor: z.enum(VENDORS),
  credentialKind: z.enum(['oauth', 'api_key']),
  hasProfile: z.boolean(),
  createdAt: z.string(),
});
export type Me = z.infer<typeof MeSchema>;

export const ConnectKeyRequestSchema = z.object({
  vendor: z.enum(['openai', 'anthropic']),
  apiKey: z.string().trim().min(20).max(400),
});
export type ConnectKeyRequest = z.infer<typeof ConnectKeyRequestSchema>;
