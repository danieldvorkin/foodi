import type { Config } from '../../config.js';
import type { Logger } from '../../lib/logger.js';
import { createOidcProvider, type TokenResponse } from './oidc.js';
import type { CredentialPayload, OAuthProvider } from './types.js';

/**
 * "Continue with ChatGPT". Standard OIDC against auth.openai.com. After sign-in we try the
 * RFC 8693 token exchange to turn the id_token into an API key for the person's OpenAI org
 * (that is the sanctioned way to call the API on their behalf). If the exchange isn't
 * available for this account we keep the OAuth tokens and the AI layer reports clearly when
 * they can't be used for generation, so the person can connect an API key instead.
 */
export function createOpenAiProvider(config: Config, log: Logger): OAuthProvider | null {
  const c = config.openai;
  if (!c.clientId) return null;
  const tokenUrl = c.tokenUrl ?? `${c.issuer.replace(/\/$/, '')}/oauth/token`;

  async function toCredential(tokens: TokenResponse): Promise<CredentialPayload> {
    if (c.exchangeApiKey && tokens.id_token) {
      try {
        const body = new URLSearchParams({
          grant_type: 'urn:ietf:params:oauth:grant-type:token-exchange',
          client_id: c.clientId!,
          requested_token: 'openai-api-key',
          subject_token: tokens.id_token,
          subject_token_type: 'urn:ietf:params:oauth:token-type:id_token',
        });
        const res = await fetch(tokenUrl, {
          method: 'POST',
          headers: { 'content-type': 'application/x-www-form-urlencoded', accept: 'application/json' },
          body,
        });
        if (res.ok) {
          const data = (await res.json()) as { access_token?: string };
          if (data.access_token) return { kind: 'api_key', apiKey: data.access_token };
        } else {
          log.warn({ status: res.status }, 'openai token exchange not available for this account');
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'openai token exchange failed');
      }
    }
    return {
      kind: 'oauth',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token ?? null,
      expiresAt: tokens.expires_in ? new Date(Date.now() + tokens.expires_in * 1000).toISOString() : null,
      idToken: tokens.id_token ?? null,
    };
  }

  return createOidcProvider({
    id: 'openai',
    vendor: 'openai',
    label: 'Continue with ChatGPT',
    note: null,
    issuer: c.issuer,
    clientId: c.clientId,
    clientSecret: c.clientSecret,
    scopes: c.scopes,
    authorizationUrl: c.authorizationUrl ?? `${c.issuer.replace(/\/$/, '')}/oauth/authorize`,
    tokenUrl,
    jwksUrl: c.jwksUrl,
    extraAuthParams: { id_token_add_organizations: 'true' },
    toCredential,
  });
}
