import { describe, expect, it, vi } from 'vitest';
import { emptyProfile } from '@foodi/shared';
import { createAiService, needsRefresh } from '../ai/service.js';
import { createOidcProvider } from './providers/oidc.js';
import { credentialProvider, type CredentialPayload } from './providers/types.js';
import { createMockClient } from '../ai/mock.js';
import { loadConfig } from '../config.js';
import { openDb } from '../db/index.js';
import { sha256 } from '../lib/crypto.js';
import { createLogger } from '../lib/logger.js';
import { createSettings } from '../services/settings.js';
import { createAuthStore } from './store.js';

const oauth = (over: Partial<Extract<CredentialPayload, { kind: 'oauth' }>> = {}): CredentialPayload => ({
  kind: 'oauth',
  accessToken: 'at-old',
  refreshToken: 'rt-old',
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
  idToken: 'id-old',
  ...over,
});

const issuerUrl = 'https://vendor.test';
const tokenUrl = `${issuerUrl}/oauth/token`;
const provider = (fetchImpl: typeof fetch, id = 'openai', endpoint = tokenUrl) =>
  createOidcProvider({ id, vendor: 'openai', label: id, issuer: issuerUrl, clientId: 'cid', clientSecret: 'test-secret', scopes: 'openid', authorizationUrl: `${issuerUrl}/authorize`, tokenUrl: endpoint, fetchImpl });

const callbackInput = { code: 'code', redirectUri: 'http://app.test/callback', transaction: {} };
const accessToken = ['e30', Buffer.from(JSON.stringify({ sub: 'test-user' })).toString('base64url'), 'signature'].join('.');
const signInResponse = () => Response.json({ access_token: accessToken, refresh_token: 'rt-old', expires_in: 20 });

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
      const form = Object.fromEntries(new URLSearchParams(init!.body as string));
      if (form['grant_type'] === 'authorization_code') return signInResponse();
      sent.push(form);
      return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
    };

  it('swaps the refresh token for a new access token, keeping the old one when none comes back', async () => {
    const p = provider(reply(200, { access_token: 'at-new', expires_in: 3600 }));
    const { credential } = await p.callback(callbackInput);
    const fresh = await p.refresh!(credential);
    expect(fresh).toMatchObject({ kind: 'oauth', accessToken: 'at-new', refreshToken: 'rt-old', idToken: null, source: expect.objectContaining({ providerId: 'openai' }) });
    expect(Date.parse((fresh as { expiresAt: string }).expiresAt)).toBeGreaterThan(Date.now() + 3_000_000);
    expect(sent.at(-1)).toMatchObject({ grant_type: 'refresh_token', refresh_token: 'rt-old', client_id: 'cid' });
  });

  it('takes a rotated refresh token when the vendor sends one', async () => {
    const p = provider(reply(200, { access_token: 'at-new', refresh_token: 'rt-new', expires_in: 60 }));
    expect(await p.refresh!((await p.callback(callbackInput)).credential)).toMatchObject({ refreshToken: 'rt-new' });
  });

  it.each(['http://vendor.test/oauth/token', 'not an absolute URL'])('refuses token POSTs to %s', async (endpoint) => {
    const fetchImpl = vi.fn<typeof fetch>();
    const p = provider(fetchImpl, 'openai', endpoint);
    const credential = oauth({ source: { providerId: 'openai', binding: sha256(JSON.stringify(['openai', issuerUrl, 'cid', endpoint])) } });

    await expect(p.callback(callbackInput)).rejects.toMatchObject({ code: 'oauth_insecure_token_endpoint' });
    await expect(p.refresh!(credential)).resolves.toBeNull();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects redirects on both HTTPS token exchanges', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => signInResponse());
    const p = provider(fetchImpl);
    const { credential } = await p.callback(callbackInput);
    await p.refresh!(credential);
    expect(fetchImpl.mock.calls.map(([url, init]) => [url, init?.redirect])).toEqual([
      [tokenUrl, 'error'],
      [tokenUrl, 'error'],
    ]);
  });

  it('gives back nothing it cannot refresh, so the old credential is left alone', async () => {
    for (const p of [provider(reply(400, { error: 'invalid_grant' })), provider(reply(200, { no_token: true }))]) {
      expect(await p.refresh!((await p.callback(callbackInput)).credential)).toBeNull();
    }
    expect(await provider(reply(200, {})).refresh!(oauth({ refreshToken: null }))).toBeNull();
    expect(await provider(reply(200, {})).refresh!({ kind: 'api_key', apiKey: 'sk-x' })).toBeNull();
  });
});

it('routes a persisted SSO credential to its issuer even when OpenAI is registered first', async () => {
  const db = openDb(':memory:');
  try {
    const store = createAuthStore(db, { encryptionKey: Buffer.alloc(32), bootstrapFirstAdmin: false, adminEmails: [] });
    const builtin = vi.fn<typeof fetch>();
    const ssoFetch = vi.fn<typeof fetch>()
      .mockImplementationOnce(async () => signInResponse())
      .mockImplementationOnce(async () => Response.json({ access_token: 'at-new', refresh_token: 'rt-new' }));
    const ssoEndpoint = 'https://sso.test/oauth/token';
    const sso = provider(ssoFetch, 'sso', ssoEndpoint);
    const providers = [provider(builtin), sso];
    const { identity, credential } = await sso.callback(callbackInput);
    const user = store.signIn(identity, credential, 'openai');
    const saved = store.getCredential(user.id)!;
    const issuer = credentialProvider(providers, saved.vendor, saved.payload);

    expect(await issuer?.refresh?.(saved.payload)).toMatchObject({ accessToken: 'at-new', refreshToken: 'rt-new' });
    expect(ssoFetch.mock.calls[1]?.[0]).toBe(ssoEndpoint);
    expect(builtin).not.toHaveBeenCalled();
    expect(credentialProvider(providers, 'openai', oauth())).toBeUndefined();
    expect(credentialProvider(providers.slice(0, 1), saved.vendor, saved.payload)).toBeUndefined();

    const reconfigured = provider(builtin, 'sso', 'https://different.test/oauth/token');
    expect(await reconfigured.refresh?.(saved.payload)).toBeNull();
    expect(builtin).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

function refreshFixture() {
  const db = openDb(':memory:');
  const config = loadConfig({ NODE_ENV: 'test', FOODI_SESSION_SECRET: 'test-session-secret-for-refresh-fixtures', FOODI_ENCRYPTION_KEY: '00'.repeat(32) });
  const store = createAuthStore(db, { encryptionKey: config.encryptionKey, bootstrapFirstAdmin: false, adminEmails: [] });
  const user = store.register({ email: 'test@example.test', displayName: 'Cook', passwordHash: 'unused' })!;
  const client = createMockClient();
  const scan = vi.spyOn(client, 'scanIngredients');
  const generate = vi.spyOn(client, 'generate');
  let resolve!: (credential: CredentialPayload | null) => void;
  const result = new Promise<CredentialPayload | null>((done) => { resolve = done; });
  const refresh = vi.fn(() => result);
  const settings = createSettings(db);
  const ai = createAiService({ config, db, log: createLogger('silent', false), store, settings, clients: { openai: client }, refreshCredential: refresh });
  const stale = oauth({ expiresAt: new Date(0).toISOString() });
  store.setCredential(user.id, 'openai', stale);
  return { ai, db, store, user, scan, generate, settings, refresh, resolve, stale, call: () => ai.scanIngredients(user.id, Buffer.alloc(0), [{ id: '1', text: 'carrot' }]) };
}

it('shares overlapping refresh calls, saves the rotated token, and releases the refresh slot', async () => {
  const f = refreshFixture();
  try {
    const first = f.call();
    const second = f.call();
    await Promise.resolve();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    const fresh = oauth({ accessToken: 'at-new', refreshToken: 'rt-new' });
    f.resolve(fresh);
    await Promise.all([first, second]);
    expect(f.scan.mock.calls.map((args) => args[2])).toEqual([fresh, fresh]);
    expect(f.store.getCredential(f.user.id)?.payload).toEqual(fresh);

    f.store.setCredential(f.user.id, 'openai', f.stale);
    f.refresh.mockResolvedValueOnce(null);
    await f.call();
    expect(f.refresh).toHaveBeenCalledTimes(2);
    expect(f.scan.mock.lastCall?.[2]).toEqual(f.stale);
  } finally {
    f.db.close();
  }
});

it.each(['api key', 'unexpired OAuth', 'same tokens', 'disconnect'])('preserves a concurrent %s during refresh', async (change) => {
  const f = refreshFixture();
  try {
    const pending = f.call();
    await Promise.resolve();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    const replacement: CredentialPayload = change === 'same tokens' ? f.stale
      : change === 'unexpired OAuth' ? oauth({ accessToken: 'unexpired' })
        : { kind: 'api_key', apiKey: 'new-key' };
    if (change === 'disconnect') f.store.clearCredential(f.user.id);
    else f.store.setCredential(f.user.id, 'openai', replacement);
    f.refresh.mockResolvedValueOnce(null);
    f.resolve(oauth({ accessToken: 'at-new' }));
    if (change === 'disconnect') {
      await expect(pending).rejects.toMatchObject({ code: 'no_vision' });
      expect(f.store.getCredential(f.user.id)).toBeNull();
      expect(f.scan).not.toHaveBeenCalled();
    } else {
      await pending;
      expect(f.store.getCredential(f.user.id)?.payload).toEqual(replacement);
      expect(f.scan.mock.lastCall?.[2]).toEqual(replacement);
    }
    expect(f.refresh).toHaveBeenCalledTimes(change === 'same tokens' ? 2 : 1);
  } finally {
    f.db.close();
  }
});

it('shares the refresh of an expired replacement and uses only its refreshed credential', async () => {
  const f = refreshFixture();
  try {
    const first = f.call();
    await Promise.resolve();
    const replacement = oauth({ accessToken: 'replacement', expiresAt: new Date(0).toISOString() });
    f.store.setCredential(f.user.id, 'openai', replacement);
    const second = f.call();
    const fresh = oauth({ accessToken: 'fresh-replacement' });
    f.refresh.mockResolvedValueOnce(fresh);
    f.resolve(oauth({ accessToken: 'superseded' }));
    await Promise.all([first, second]);

    expect(f.refresh.mock.calls).toEqual([['openai', f.stale], ['openai', replacement]]);
    expect(f.store.getCredential(f.user.id)?.payload).toEqual(fresh);
    expect(f.scan.mock.calls.map((args) => args[2])).toEqual([fresh, fresh]);
  } finally {
    f.db.close();
  }
});

it('enforces the managed recipe quota when a managed key replaces a refreshing credential', async () => {
  const f = refreshFixture();
  try {
    f.settings.update({ managedGenerationsPerUserPerDay: 1 });
    f.db.prepare("INSERT INTO generations (id, user_id, vendor, model, status, latency_ms, created_at) VALUES ('prior', ?, 'openai', 'test', 'ok', 1, ?)")
      .run(f.user.id, new Date().toISOString());
    const pending = f.ai.generate(f.user.id, {
      profile: emptyProfile, prompt: 'soup', requestedIngredients: [], servings: 2,
      timeBudgetMinutes: 30, mealType: null, basedOn: null, avoidTitles: [], seed: null,
    });
    await Promise.resolve();
    expect(f.refresh).toHaveBeenCalledTimes(1);
    f.store.setCredential(f.user.id, 'openai', { kind: 'managed', apiKey: 'test-key', projectId: 'test', serviceAccountId: 'test', keyId: null });
    f.resolve(oauth({ accessToken: 'superseded' }));
    await expect(pending).rejects.toMatchObject({ status: 429, code: 'quota' });
    expect(f.generate).not.toHaveBeenCalled();
  } finally {
    f.db.close();
  }
});
