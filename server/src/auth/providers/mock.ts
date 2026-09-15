import type { Config } from '../../config.js';
import { createOidcProvider } from './oidc.js';
import type { OAuthProvider } from './types.js';

export const MOCK_CLIENT_ID = 'foodi-local';

/** Dev-only: talks to the in-process mock authorization server through the real OIDC client. */
export function createMockProvider(config: Config): OAuthProvider {
  const issuer = `${config.apiOrigin}/mock-oauth`;
  return createOidcProvider({
    id: 'mock',
    vendor: 'mock',
    label: 'Continue with a mock account',
    note: 'Development only. Uses a fake identity provider and a fake AI so you can try everything without credentials.',
    issuer,
    clientId: MOCK_CLIENT_ID,
    scopes: 'openid profile email',
  });
}
