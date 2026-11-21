import { describe, expect, it } from 'vitest';
import { needsRefresh } from '../ai/service.js';
import { createOidcProvider } from './providers/oidc.js';
import type { CredentialPayload } from './providers/types.js';

const oauth = (over: Partial<Extract<CredentialPayload, { kind: 'oauth' }>> = {}): CredentialPayload => ({
  kind: 'oauth',
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  idToken: 'id-old',
  ...over,
});

const provider = (fetchImpl: typeof fetch) =>
  createOidcProvider({ id: 'openai', vendor: 'openai', label: 'ChatGPT', issuer: 'http://vendor.test', clientId: 'cid', scopes: 'openid', tokenUrl: 'http://vendor.test/oauth/token', fetchImpl });

describe('deciding when to refresh', () => {
  it('refreshes only an OAuth credential that is about to run out and can be refreshed', () => {
    const soon = new Date(Date.now() + 30_000).toISOString();
    expect(needsRefresh(oauth({ expiresAt: soon }))).toBe(true);
    expect(needsRefresh(oauth())).toBe(false); // an hour left
    expect(needsRefresh(oauth({ expiresAt: soon, refreshToken: null }))).toBe(false); // nothing to refresh with
    expect(needsRefresh(oauth({ expiresAt: null }))).toBe(false); // no expiry given: let the vendor judge
    expect(needsRefresh({ kind: 'api_key', apiKey: 'sk-x' })).toBe(false);
  });
});

describe('refreshing against the vendor', () => {
  const sent: Record<string, string>[] = [];
  const reply =
    (status: number, body: unknown): typeof fetch =>
    async (_url, init) => {
      sent.push(Object.fromEntries(new URLSearchParams(init!.body as string)));
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };

  it('swaps the refresh token for a new access token, keeping the old one when none comes back', async () => {
    const p = provider(reply(200, { access_token: 'at-new', expires_in: 3600 }));
    const fresh = await p.refresh!(oauth());
    expect(fresh).toMatchObject({ kind: 'oauth', accessToken: 'at-new', refreshToken: 'rt-old', idToken: 'id-old' });
    expect(Date.parse((fresh as { expiresAt: string }).expiresAt)).toBeGreaterThan(Date.now() + 3_000_000);
    expect(sent.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-old', client_id: 'cid' });
  });

  it('takes a rotated refresh token when the vendor sends one', async () => {
    const p = provider(reply(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 60 }));
    expect(await p.refresh!(oauth())).toMatchObject({ refreshToken: 'rt-new' });
  });

  it('gives back nothing it cannot refresh, so the old credential is left alone', async () => {
    expect(await provider(reply(400, { error: 'invalid_grant' })).refresh!(oauth())).toBeNull();
    expect(await provider(reply(200, { no_token: true })).refresh!(oauth())).toBeNull();
    expect(await provider(reply(200, {})).refresh!(oauth({ refreshToken: null }))).toBeNull();
    expect(await provider(reply(200, {})).refresh!({ kind: 'api_key', apiKey: 'sk-x' })).toBeNull();
  });
});
