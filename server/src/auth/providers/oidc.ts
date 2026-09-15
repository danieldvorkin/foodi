import { createRemoteJWKSet, jwtVerify, decodeJwt } from 'jose';
import { pkcePair, randomToken } from '../../lib/crypto.js';
import { HttpError } from '../../lib/errors.js';
import type { CredentialPayload, Identity, OAuthProvider } from './types.js';
import type { Vendor } from '@foodi/shared';

export interface OidcProviderOptions {
  id: string;
  vendor: Vendor;
  label: string;
  note?: string | null;
  issuer: string;
  clientId: string;
  clientSecret?: string | undefined;
  scopes: string;
  authorizationUrl?: string | undefined;
  tokenUrl?: string | undefined;
  jwksUrl?: string | undefined;
  /** Extra query params on the authorize URL. */
  extraAuthParams?: Record<string, string>;
  /** Hook to turn raw tokens into the credential we store (e.g. token exchange). */
  toCredential?: (tokens: TokenResponse, claims: Record<string, unknown>) => Promise<CredentialPayload>;
  fetchImpl?: typeof fetch;
}

export interface TokenResponse {
  access_token: string;
  token_type?: string;
  expires_in?: number;
  refresh_token?: string;
  id_token?: string;
  scope?: string;
}

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri?: string;
  revocation_endpoint?: string;
}

/**
 * A standards-based OAuth 2.0 Authorization Code + PKCE (S256) client with OIDC id_token
 * verification. Endpoints come from OIDC discovery unless overridden in config.
 */
export function createOidcProvider(opts: OidcProviderOptions): OAuthProvider {
  const f = opts.fetchImpl ?? fetch;
  let discovery: Promise<Discovery> | null = null;
  let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

  async function discover(): Promise<Discovery> {
    if (opts.authorizationUrl && opts.tokenUrl) {
      return {
        authorization_endpoint: opts.authorizationUrl,
        token_endpoint: opts.tokenUrl,
        ...(opts.jwksUrl ? { jwks_uri: opts.jwksUrl } : {}),
      };
    }
    discovery ??= (async () => {
      const url = `${opts.issuer.replace(/\/$/, '')}/.well-known/openid-configuration`;
      const res = await f(url, { headers: { accept: 'application/json' } });
      if (!res.ok) throw new HttpError(502, 'oidc_discovery_failed', `${opts.label}: discovery failed (${res.status}) at ${url}`);
      const doc = (await res.json()) as Partial<Discovery>;
      if (!doc.authorization_endpoint || !doc.token_endpoint) {
        throw new HttpError(502, 'oidc_discovery_failed', `${opts.label}: discovery document is missing endpoints`);
      }
      return {
        authorization_endpoint: opts.authorizationUrl ?? doc.authorization_endpoint,
        token_endpoint: opts.tokenUrl ?? doc.token_endpoint,
        ...((opts.jwksUrl ?? doc.jwks_uri) ? { jwks_uri: opts.jwksUrl ?? doc.jwks_uri } : {}),
        ...(doc.revocation_endpoint ? { revocation_endpoint: doc.revocation_endpoint } : {}),
      };
    })();
    return discovery;
  }

  async function verifyIdToken(idToken: string, nonce: string): Promise<Record<string, unknown>> {
    const d = await discover();
    if (!d.jwks_uri) {
      throw new HttpError(502, 'oidc_no_jwks', `${opts.label}: no JWKS endpoint to verify the id_token`);
    }
    jwks ??= createRemoteJWKSet(new URL(d.jwks_uri));
    const { payload } = await jwtVerify(idToken, jwks, {
      issuer: [opts.issuer, opts.issuer.replace(/\/$/, ''), `${opts.issuer.replace(/\/$/, '')}/`],
      audience: opts.clientId,
      clockTolerance: 60,
    });
    if (payload['nonce'] !== nonce) throw new HttpError(400, 'oidc_bad_nonce', 'Sign-in response did not match this browser. Try again.');
    return payload as Record<string, unknown>;
  }

  return {
    id: opts.id,
    vendor: opts.vendor,
    label: opts.label,
    kind: 'oauth',
    note: opts.note ?? null,

    async start({ state, redirectUri, loginHint }) {
      const d = await discover();
      const { verifier, challenge } = pkcePair();
      const nonce = randomToken(16);
      const url = new URL(d.authorization_endpoint);
      url.searchParams.set('response_type', 'code');
      url.searchParams.set('client_id', opts.clientId);
      url.searchParams.set('redirect_uri', redirectUri);
      url.searchParams.set('scope', opts.scopes);
      url.searchParams.set('state', state);
      url.searchParams.set('nonce', nonce);
      url.searchParams.set('code_challenge', challenge);
      url.searchParams.set('code_challenge_method', 'S256');
      if (loginHint) url.searchParams.set('login_hint', loginHint);
      for (const [k, v] of Object.entries(opts.extraAuthParams ?? {})) url.searchParams.set(k, v);
      return { url: url.toString(), transaction: { verifier, nonce } };
    },

    async callback({ code, redirectUri, transaction }) {
      const d = await discover();
      const body = new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: redirectUri,
        client_id: opts.clientId,
        code_verifier: transaction['verifier'] ?? '',
      });
      if (opts.clientSecret) body.set('client_secret', opts.clientSecret);
      const res = await f(d.token_endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
        body,
      });
      if (!res.ok) {
        throw new HttpError(502, 'oauth_token_exchange_failed', `${opts.label}: could not exchange the sign-in code (${res.status}).`);
      }
      const tokens = (await res.json()) as TokenResponse;
      if (!tokens.access_token) throw new HttpError(502, 'oauth_no_access_token', `${opts.label}: no access token returned.`);

      let claims: Record<string, unknown> = {};
      if (tokens.id_token) {
        claims = await verifyIdToken(tokens.id_token, transaction['nonce'] ?? '');
      } else {
        // Non-OIDC providers: we still need a stable subject. Try the access token as a JWT.
        try {
          claims = decodeJwt(tokens.access_token) as Record<string, unknown>;
        } catch {
          throw new HttpError(502, 'oauth_no_identity', `${opts.label}: no identity was returned.`);
        }
      }
      const subject = String(claims['sub'] ?? '');
      if (!subject) throw new HttpError(502, 'oauth_no_subject', `${opts.label}: identity has no subject.`);

      const identity: Identity = {
        provider: opts.id,
        subject,
        email: typeof claims['email'] === 'string' ? claims['email'] : null,
        displayName:
          (typeof claims['name'] === 'string' && claims['name']) ||
          (typeof claims['preferred_username'] === 'string' && claims['preferred_username']) ||
          (typeof claims['email'] === 'string' && claims['email'].split('@')[0]) ||
          null,
      };

      const credential: CredentialPayload = opts.toCredential
        ? await opts.toCredential(tokens, claims)
        : {
            kind: 'oauth',
            accessToken: tokens.access_token,
            refreshToken: tokens.refresh_token ?? null,
            expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
            idToken: tokens.id_token ?? null,
          };
      return { identity, credential };
    },

    async revoke(credential) {
      if (credential.kind !== 'oauth') return;
      const d = await discover().catch(() => null);
      if (!d?.revocation_endpoint) return;
      const body = new URLSearchParams({ token: credential.refreshToken ?? credential.accessToken, client_id: opts.clientId });
      if (opts.clientSecret) body.set('client_secret', opts.clientSecret);
      await f(d.revocation_endpoint, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body }).catch(() => {});
    },
  };
}
