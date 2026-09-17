import type { Vendor } from '@foodi/shared';

/** What we learned about the person from the identity provider. */
export interface Identity {
  provider: string;
  subject: string;
  email: string | null;
  /** True only when the provider itself vouches for the address (OIDC email_verified). */
  emailVerified: boolean;
  displayName: string | null;
}

/** The secret we use to call the AI vendor on the person's behalf. Stored encrypted. */
export type CredentialPayload =
  | { kind: 'api_key'; apiKey: string }
  | { kind: 'oauth'; accessToken: string; refreshToken: string | null; expiresAt: string | null; idToken: string | null }
  /** A key foodi created for this person on its own OpenAI organisation; the ids let us revoke it. */
  | { kind: 'managed'; apiKey: string; projectId: string; serviceAccountId: string; keyId: string | null };

export interface OAuthStartResult {
  url: string;
  /** Opaque data we must get back on callback (PKCE verifier, nonce). */
  transaction: Record<string, string>;
}

export interface OAuthProvider {
  id: string;
  vendor: Vendor;
  label: string;
  kind: 'oauth';
  note: string | null;
  start(input: { state: string; redirectUri: string; loginHint?: string | undefined }): Promise<OAuthStartResult>;
  callback(input: {
    code: string;
    redirectUri: string;
    transaction: Record<string, string>;
  }): Promise<{ identity: Identity; credential: CredentialPayload }>;
  /** Called on sign-out where the vendor supports revocation. Best effort. */
  revoke?(credential: CredentialPayload): Promise<void>;
}

export interface ApiKeyProvider {
  id: string;
  vendor: Vendor;
  label: string;
  kind: 'api_key';
  note: string | null;
  /** Verify the key against the vendor and return a stable identity for it. */
  verify(apiKey: string): Promise<{ ok: true; identity: Identity } | { ok: false; reason: string }>;
}

export type AuthProvider = OAuthProvider | ApiKeyProvider;
