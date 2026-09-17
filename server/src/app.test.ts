import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { createServer } from 'node:http';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { decrypt, encrypt, pkcePair } from './lib/crypto.js';
import { encodePng } from './lib/png.js';
import { createMockClient } from './ai/mock.js';
import type { PhotoSource } from './photos/types.js';

const ORIGIN = 'http://localhost:5100';

type Seams = Pick<Parameters<typeof createApp>[0], 'aiClients' | 'photoSources' | 'photoFetch' | 'openaiAdminFetch'>;

async function boot(extraEnv: Record<string, string> = {}, aiClients?: Seams['aiClients'], seams: Omit<Seams, 'aiClients'> = {}) {
  const config = loadConfig({ ...process.env, ...extraEnv, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: 'http://127.0.0.1:0' });
  const log = createLogger('silent', false);
  const built = await createApp({ config, log, ...(aiClients ? { aiClients } : {}), ...seams });
  // The mock IdP needs a reachable issuer; bind an ephemeral port and rewrite the origin.
  const server = built.app.listen(0);
  const port = (server.address() as { port: number }).port;
  server.close();
  built.close();
  const cfg2 = loadConfig({ ...process.env, ...extraEnv, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: `http://127.0.0.1:${port}` });
  const built2 = await createApp({ config: cfg2, log, ...(aiClients ? { aiClients } : {}), ...seams });
  const server2 = built2.app.listen(port);
  return { ...built2, server: server2, base: `http://127.0.0.1:${port}`, config: cfg2 };
}

type Booted = Awaited<ReturnType<typeof boot>>;

/** Drive the real OAuth code path against the in-process mock IdP. Returns the session cookie. */
async function signIn(b: Booted, sub = 'mock-ada'): Promise<string> {
  const start = await request(b.base).get('/api/auth/mock/start?returnTo=/app');
  expect(start.status).toBe(302);
  const oauthCookie = start.headers['set-cookie']![0]!.split(';')[0]!;
  const authz = new URL(start.headers['location']!);
  const approve = await request(b.base)
    .post('/mock-oauth/approve')
    .type('form')
    .send({
      sub,
      state: authz.searchParams.get('state'),
      nonce: authz.searchParams.get('nonce'),
      code_challenge: authz.searchParams.get('code_challenge'),
      redirect_uri: authz.searchParams.get('redirect_uri'),
      client_id: authz.searchParams.get('client_id'),
    });
  expect(approve.status).toBe(303);
  const cb = new URL(approve.headers['location']!);
  const done = await request(b.base).get(cb.pathname + cb.search).set('cookie', oauthCookie);
  expect(done.status).toBe(302);
  const session = (done.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!).find((c) => c.startsWith('foodi_session='))!;
  expect(session).toBeTruthy();
  return session;
}

const PROFILE = {
  displayName: 'Ada',
  units: 'metric',
  diet: 'vegetarian',
  allergies: ['peanuts', 'dairy'],
  dislikes: [],
  cuisines: ['Italian'],
  skill: 'comfortable',
  spice: 'medium',
  timeBudgetMinutes: 30,
  householdSize: 2,
  equipment: ['stovetop', 'oven'],
  goals: ['quick weeknights'],
};

describe('crypto', () => {
  it('round-trips AES-GCM and rejects tampering', () => {
    const key = Buffer.alloc(32, 7);
    const ct = encrypt('hello', key);
    expect(decrypt(ct, key)).toBe('hello');
    const [v, iv, body, tag] = ct.split('.');
    // Change the first character of the auth tag (a full 6 data bits, never padding) so the tamper is guaranteed.
    const flipped = tag![0] === 'A' ? 'B' : 'A';
    expect(() => decrypt(`${v}.${iv}.${body}.${flipped}${tag!.slice(1)}`, key)).toThrow();
  });
  it('produces RFC 7636 compliant PKCE pairs', () => {
    const { verifier, challenge } = pkcePair();
    expect(verifier.length).toBeGreaterThanOrEqual(43);
    expect(challenge).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });
});

describe('auth', () => {
  let b: Booted;
  beforeEach(async () => {
    b = await boot();
  });
  afterEach(() => {
    b.server.close();
    b.close();
  });

  it('lists providers without leaking secrets', async () => {
    const res = await request(b.base).get('/api/auth/providers');
    expect(res.status).toBe(200);
    expect(res.body.providers.map((p: { id: string }) => p.id)).toEqual(['anthropic', 'openai-key', 'mock']);
    expect(JSON.stringify(res.body)).not.toMatch(/secret|client_secret/i);
  });

  it('rejects a callback whose state does not match the browser', async () => {
    const start = await request(b.base).get('/api/auth/mock/start');
    const oauthCookie = start.headers['set-cookie']![0]!.split(';')[0]!;
    const res = await request(b.base).get('/api/auth/mock/callback?code=abc&state=wrong').set('cookie', oauthCookie);
    expect(res.status).toBe(302);
    expect(res.headers['location']).toContain('/?error=');
    expect((res.headers['set-cookie'] as unknown as string[] | undefined)?.some((c) => c.startsWith('foodi_session='))).toBeFalsy();
  });

  it('signs in through OAuth+PKCE, first user becomes admin, session cookie is httpOnly', async () => {
    const session = await signIn(b);
    const me = await request(b.base).get('/api/auth/me').set('cookie', session);
    expect(me.status).toBe(200);
    expect(me.body.role).toBe('admin');
    expect(me.body.email).toBe('ada@example.com');
    expect(me.body.hasProfile).toBe(false);
    const second = await signIn(b, 'mock-sam');
    const me2 = await request(b.base).get('/api/auth/me').set('cookie', second);
    expect(me2.body.role).toBe('consumer');
  });

  it('never stores the raw session token or a plaintext credential', async () => {
    await signIn(b);
    const sessions = b.db.prepare('SELECT id_hash FROM sessions').all() as { id_hash: string }[];
    expect(sessions[0]!.id_hash).toMatch(/^[0-9a-f]{64}$/);
    const cred = b.db.prepare('SELECT payload_enc FROM credentials').get() as { payload_enc: string };
    expect(cred.payload_enc).toMatch(/^v1\./);
    expect(cred.payload_enc).not.toContain('mock-access');
  });

  it('blocks cross-site state changes and allows same-origin ones', async () => {
    const session = await signIn(b);
    const blocked = await request(b.base).put('/api/profile').set('cookie', session).send(PROFILE);
    expect(blocked.status).toBe(403);
    const evil = await request(b.base).put('/api/profile').set('cookie', session).set('origin', 'https://evil.example').send(PROFILE);
    expect(evil.status).toBe(403);
    const ok = await request(b.base).put('/api/profile').set('cookie', session).set('origin', ORIGIN).send(PROFILE);
    expect(ok.status).toBe(200);
  });

  it('logs out and the cookie stops working', async () => {
    const session = await signIn(b);
    await request(b.base).post('/api/auth/logout').set('cookie', session).set('origin', ORIGIN);
    const me = await request(b.base).get('/api/auth/me').set('cookie', session);
    expect(me.status).toBe(401);
  });

  it('only ever redirects to a path on our own app', async () => {
    const start = await request(b.base).get('/api/auth/mock/start?returnTo=//evil.example/x');
    const oauthCookie = start.headers['set-cookie']![0]!.split(';')[0]!;
    const authz = new URL(start.headers['location']!);
    const approve = await request(b.base).post('/mock-oauth/approve').type('form').send({
      sub: 'mock-ada',
      state: authz.searchParams.get('state'),
      nonce: authz.searchParams.get('nonce'),
      code_challenge: authz.searchParams.get('code_challenge'),
      redirect_uri: authz.searchParams.get('redirect_uri'),
      client_id: authz.searchParams.get('client_id'),
    });
    const cb = new URL(approve.headers['location']!);
    const done = await request(b.base).get(cb.pathname + cb.search).set('cookie', oauthCookie);
    expect(done.headers['location']).toBe(`${ORIGIN}/onboarding`);
  });
});

describe('rbac', () => {
  let b: Booted;
  beforeEach(async () => {
    b = await boot();
  });
  afterEach(() => {
    b.server.close();
    b.close();
  });

  it('consumers cannot reach admin routes; admins can', async () => {
    const admin = await signIn(b, 'mock-ada');
    const consumer = await signIn(b, 'mock-sam');
    expect((await request(b.base).get('/api/admin/stats').set('cookie', consumer)).status).toBe(403);
    expect((await request(b.base).get('/api/admin/stats')).status).toBe(401);
    const ok = await request(b.base).get('/api/admin/stats').set('cookie', admin);
    expect(ok.status).toBe(200);
    expect(ok.body.users).toBe(2);
  });

  it('admin can change roles and disable users, with an audit trail; cannot demote self', async () => {
    const admin = await signIn(b, 'mock-ada');
    const consumer = await signIn(b, 'mock-sam');
    const users = await request(b.base).get('/api/admin/users').set('cookie', admin);
    const sam = users.body.users.find((u: { email: string }) => u.email === 'sam@example.com');
    const adminMe = await request(b.base).get('/api/auth/me').set('cookie', admin);

    const self = await request(b.base).patch(`/api/admin/users/${adminMe.body.id}`).set('cookie', admin).set('origin', ORIGIN).send({ role: 'consumer' });
    expect(self.status).toBe(400);

    const promote = await request(b.base).patch(`/api/admin/users/${sam.id}`).set('cookie', admin).set('origin', ORIGIN).send({ role: 'admin' });
    expect(promote.body.user.role).toBe('admin');
    expect((await request(b.base).get('/api/admin/stats').set('cookie', consumer)).status).toBe(200);

    const disable = await request(b.base).patch(`/api/admin/users/${sam.id}`).set('cookie', admin).set('origin', ORIGIN).send({ disabled: true });
    expect(disable.body.user.disabledAt).toBeTruthy();
    expect((await request(b.base).get('/api/auth/me').set('cookie', consumer)).status).toBe(401);

    const audit = await request(b.base).get('/api/admin/audit').set('cookie', admin);
    // Both entries can land in the same millisecond, so the order is not stable.
    expect(audit.body.entries.map((e: { action: string }) => e.action).sort()).toEqual(['user.disable', 'user.role']);
  });
});

describe('recipes', () => {
  let b: Booted;
  let session: string;
  beforeEach(async () => {
    b = await boot();
    session = await signIn(b);
    await request(b.base).put('/api/profile').set('cookie', session).set('origin', ORIGIN).send(PROFILE);
  });
  afterEach(() => {
    b.server.close();
    b.close();
  });

  it('generates a recipe that respects allergies and links ingredients to the library', async () => {
    const res = await request(b.base)
      .post('/api/recipes/generate?sync=1')
      .set('cookie', session)
      .set('origin', ORIGIN)
      .send({ prompt: 'a quick pasta', ingredientIds: ['spinach', 'cherry-tomato'] });
    expect(res.status).toBe(201);
    const { content, warnings } = res.body.recipe;
    expect(content.steps.length).toBeGreaterThan(3);
    expect(warnings).toEqual([]);
    expect(content.allergens).not.toContain('dairy');
    expect(content.allergens).not.toContain('peanuts');
    const ids = content.ingredients.map((i: { ingredientId: string | null }) => i.ingredientId);
    expect(ids).toContain('spinach');
    expect(ids).toContain('cherry-tomato');
    for (const s of content.steps) for (const ref of s.ingredientRefs) expect(ref).toBeLessThan(content.ingredients.length);
    const log = await request(b.base).get('/api/admin/generations').set('cookie', session);
    expect(log.body.generations[0].status).toBe('ok');
    expect(log.body.generations[0].recipeId).toBe(res.body.recipe.id);
  });

  it('requires onboarding first', async () => {
    const fresh = await signIn(b, 'mock-sam');
    const res = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', fresh).set('origin', ORIGIN).send({ prompt: 'anything' });
    expect(res.status).toBe(400);
  });

  it('keeps private recipes private, and sharing makes them readable', async () => {
    const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', session).set('origin', ORIGIN).send({ prompt: 'soup' });
    const id = gen.body.recipe.id;
    const other = await signIn(b, 'mock-sam');
    expect((await request(b.base).get(`/api/recipes/${id}`).set('cookie', other)).status).toBe(403);
    const post = await request(b.base).post('/api/social/posts').set('cookie', session).set('origin', ORIGIN).send({ recipeId: id, caption: 'Made this tonight' });
    expect(post.status).toBe(201);
    expect((await request(b.base).get(`/api/recipes/${id}`).set('cookie', other)).status).toBe(200);
    const feed = await request(b.base).get('/api/social/feed').set('cookie', other);
    expect(feed.body.items).toHaveLength(1);
    expect(feed.body.items[0].type).toBe('post');
    expect(feed.body.items[0].post.author.handle).toBe('ada_lovelace');
    const like = await request(b.base).post(`/api/social/posts/${post.body.post.id}/like`).set('cookie', other).set('origin', ORIGIN).send({ liked: true });
    expect(like.body.likeCount).toBe(1);
    const saved = await request(b.base).post(`/api/recipes/${id}/save`).set('cookie', other).set('origin', ORIGIN);
    expect(saved.status).toBe(201);
    // Deleting the post makes the recipe private again.
    await request(b.base).delete(`/api/social/posts/${post.body.post.id}`).set('cookie', session).set('origin', ORIGIN);
    expect((await request(b.base).get(`/api/recipes/${id}`).set('cookie', other)).status).toBe(403);
  });

  it('accepts an authored recipe and rejects oversized or malformed input', async () => {
    const res = await request(b.base)
      .post('/api/recipes')
      .set('cookie', session)
      .set('origin', ORIGIN)
      .send({
        title: 'Toast',
        summary: '',
        mealType: 'breakfast',
        servings: 1,
        totalMinutes: 5,
        activeMinutes: 0,
        difficulty: 'easy',
        ingredients: [{ item: 'bread', quantity: '2', unit: 'slice', preparation: null, note: null, group: null, optional: false, ingredientId: null }],
        steps: [{ title: 'Toast it', text: 'Toast the bread.', timerSeconds: 120, ingredientRefs: [0], temperature: null, tip: null }],
      });
    expect(res.status).toBe(201);
    expect(res.body.recipe.content.ingredients[0].ingredientId).toBe('bread');
    expect(res.body.recipe.content.allergens).toContain('gluten');
    const bad = await request(b.base).post('/api/recipes').set('cookie', session).set('origin', ORIGIN).send({ title: 'x'.repeat(500) });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('validation');
  });
});

describe('media', () => {
  let b: Booted;
  let session: string;
  beforeEach(async () => {
    b = await boot();
    session = await signIn(b);
    await request(b.base).put('/api/profile').set('cookie', session).set('origin', ORIGIN).send(PROFILE);
  });
  afterEach(() => {
    b.server.close();
    b.close();
  });

  /** A 1×1 PNG with a tEXt chunk that a scrubber must remove. */
  function pngWithText(): Buffer {
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const chunk = (type: string, data: Buffer) => {
      const len = Buffer.alloc(4);
      len.writeUInt32BE(data.length);
      return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
    };
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(1, 0);
    ihdr.writeUInt32BE(1, 4);
    ihdr[8] = 8;
    ihdr[9] = 6;
    return Buffer.concat([sig, chunk('IHDR', ihdr), chunk('tEXt', Buffer.from('Comment\0secret location')), chunk('IDAT', Buffer.from([0x78, 0x9c, 0x63, 0x00, 0x01, 0x00, 0x00, 0x05, 0x00, 0x01])), chunk('IEND', Buffer.alloc(0))]);
  }

  it('sniffs type, strips metadata, enforces ownership and visibility', async () => {
    const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', session).set('origin', ORIGIN).send({ prompt: 'soup' });
    const recipeId = gen.body.recipe.id;

    const junk = await request(b.base).post('/api/media').set('cookie', session).set('origin', ORIGIN).set('content-type', 'image/png').send(Buffer.from('definitely not an image, just text'));
    expect(junk.status).toBe(400);

    const up = await request(b.base).post(`/api/media?recipeId=${recipeId}`).set('cookie', session).set('origin', ORIGIN).set('content-type', 'application/octet-stream').send(pngWithText());
    expect(up.status).toBe(201);
    expect(up.body.media.mime).toBe('image/png');
    expect(up.body.media.width).toBe(1);

    const file = await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', session).buffer(true).parse((res, cb) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(file.status).toBe(200);
    expect(file.headers['content-type']).toBe('image/png');
    expect((file.body as Buffer).includes('secret location')).toBe(false);

    const detail = await request(b.base).get(`/api/recipes/${recipeId}`).set('cookie', session);
    expect(detail.body.recipe.media).toHaveLength(1);

    // Private recipe → media hidden from others until it is shared.
    const other = await signIn(b, 'mock-sam');
    expect((await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', other)).status).toBe(404);
    await request(b.base).post('/api/social/posts').set('cookie', session).set('origin', ORIGIN).send({ recipeId, caption: '' });
    expect((await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', other)).status).toBe(200);
    expect((await request(b.base).delete(`/api/media/${up.body.media.id}`).set('cookie', other).set('origin', ORIGIN)).status).toBe(403);
    expect((await request(b.base).delete(`/api/media/${up.body.media.id}`).set('cookie', session).set('origin', ORIGIN)).status).toBe(200);
    expect((await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', session)).status).toBe(404);
  });
});

describe('password auth', () => {
  let b: Booted;
  beforeEach(async () => {
    b = await boot();
  });
  afterEach(() => {
    b.server.close();
    b.close();
  });

  const creds = { email: 'Dan@Example.com', password: 'correct horse battery', displayName: 'Dan' };

  it('registers, signs in, rejects bad passwords with one generic message, and blocks duplicates', async () => {
    const reg = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send(creds);
    expect(reg.status).toBe(201);
    expect(reg.body.signInMethods).toEqual(['password']);
    expect(reg.body.vendor).toBeNull();
    expect(reg.body.email).toBe('dan@example.com');
    expect(reg.body.role).toBe('admin'); // first account bootstraps admin in dev
    const cookie = (reg.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('foodi_session='))!.split(';')[0]!;
    expect((await request(b.base).get('/api/auth/me').set('cookie', cookie)).status).toBe(200);

    const dup = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send(creds);
    expect(dup.status).toBe(409);

    const weak = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ ...creds, email: 'x@example.com', password: 'password1' });
    expect(weak.status).toBe(400);

    const wrong = await request(b.base).post('/api/auth/login').set('origin', ORIGIN).send({ email: creds.email, password: 'nope nope nope' });
    const unknown = await request(b.base).post('/api/auth/login').set('origin', ORIGIN).send({ email: 'nobody@example.com', password: 'nope nope nope' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error.message).toBe(unknown.body.error.message);

    const ok = await request(b.base).post('/api/auth/login').set('origin', ORIGIN).send({ email: '  DAN@example.com ', password: creds.password });
    expect(ok.status).toBe(200);
    const hash = b.db.prepare('SELECT hash FROM passwords').get() as { hash: string };
    expect(hash.hash.startsWith('scrypt$131072$8$1$')).toBe(true);
    expect(hash.hash).not.toContain(creds.password);
  });

  it('connecting an AI key requires a session, and SSO can be linked to a password account', async () => {
    const anon = await request(b.base).post('/api/auth/key').set('origin', ORIGIN).send({ vendor: 'anthropic', apiKey: 'sk-ant-xxxxxxxxxxxxxxxxxxxxxxxxxxxx' });
    expect(anon.status).toBe(401);

    const reg = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send(creds);
    const cookie = (reg.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('foodi_session='))!.split(';')[0]!;

    // Start the mock OAuth flow while signed in: it must link, not create a second user.
    const start = await request(b.base).get('/api/auth/mock/start?returnTo=/app/settings').set('cookie', cookie);
    const oauthCookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
    const authz = new URL(start.headers['location']!);
    const approve = await request(b.base).post('/mock-oauth/approve').type('form').send({
      sub: 'mock-sam',
      state: authz.searchParams.get('state'),
      nonce: authz.searchParams.get('nonce'),
      code_challenge: authz.searchParams.get('code_challenge'),
      redirect_uri: authz.searchParams.get('redirect_uri'),
      client_id: authz.searchParams.get('client_id'),
    });
    const cb = new URL(approve.headers['location']!);
    const done = await request(b.base).get(cb.pathname + cb.search).set('cookie', `${cookie}; ${oauthCookie}`);
    expect(done.headers['location']).toBe(`${ORIGIN}/app/settings`);

    const me = await request(b.base).get('/api/auth/me').set('cookie', cookie);
    expect(me.body.signInMethods.sort()).toEqual(['mock', 'password']);
    expect(me.body.vendor).toBe('mock');
    expect((b.db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number }).n).toBe(1);

    const cleared = await request(b.base).delete('/api/auth/key').set('cookie', cookie).set('origin', ORIGIN);
    expect(cleared.body.vendor).toBeNull();
  });
});

describe('mock admin button', () => {
  it('login_hint skips the chooser and Ada is an admin even when she is not the first user', async () => {
    const b = await boot();
    try {
      await signIn(b, 'mock-sam'); // first user → admin by bootstrap
      const start = await request(b.base).get('/api/auth/mock/start?login_hint=mock-ada&returnTo=/app');
      const oauthCookie = (start.headers['set-cookie'] as unknown as string[])[0]!.split(';')[0]!;
      const authz = await request(b.base).get(new URL(start.headers['location']!).pathname + new URL(start.headers['location']!).search);
      expect(authz.status).toBe(303); // no chooser page
      const cb = new URL(authz.headers['location']!);
      const done = await request(b.base).get(cb.pathname + cb.search).set('cookie', oauthCookie);
      const session = (done.headers['set-cookie'] as unknown as string[]).find((c) => c.startsWith('foodi_session='))!.split(';')[0]!;
      const me = await request(b.base).get('/api/auth/me').set('cookie', session);
      expect(me.body.email).toBe('ada@example.com');
      expect(me.body.role).toBe('admin');
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('sso-only accounts', () => {
  it('can add an email + password login, then sign in with it', async () => {
    const b = await boot();
    try {
      const session = await signIn(b, 'mock-priya');
      const noEmailNeeded = await request(b.base).post('/api/auth/password').set('cookie', session).set('origin', ORIGIN).send({ next: 'a perfectly fine passphrase' });
      expect(noEmailNeeded.status).toBe(200); // mock identity carries an email
      const login = await request(b.base).post('/api/auth/login').set('origin', ORIGIN).send({ email: 'priya@example.com', password: 'a perfectly fine passphrase' });
      expect(login.status).toBe(200);
      expect(login.body.signInMethods.sort()).toEqual(['mock', 'password']);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('security review fixes', () => {
  it('a self-typed admin email at registration does not grant admin; a verified OIDC email does', async () => {
    const config = loadConfig({ ...process.env, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: 'http://127.0.0.1:0', FOODI_ADMIN_EMAILS: 'boss@example.com,ada@example.com', FOODI_BOOTSTRAP_FIRST_ADMIN: 'false' });
    const log = createLogger('silent', false);
    const probe = await createApp({ config, log });
    const srv = probe.app.listen(0);
    const port = (srv.address() as { port: number }).port;
    srv.close();
    probe.close();
    const cfg2 = loadConfig({ ...process.env, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: `http://127.0.0.1:${port}`, FOODI_ADMIN_EMAILS: 'boss@example.com,ada@example.com', FOODI_BOOTSTRAP_FIRST_ADMIN: 'false' });
    const built = await createApp({ config: cfg2, log });
    const server = built.app.listen(port);
    const b = { ...built, server, base: `http://127.0.0.1:${port}`, config: cfg2 } as Booted;
    try {
      const reg = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ email: 'boss@example.com', password: 'a long enough passphrase', displayName: 'Impostor' });
      expect(reg.status).toBe(201);
      expect(reg.body.role).toBe('consumer');
      const ada = await signIn(b, 'mock-ada');
      const me = await request(b.base).get('/api/auth/me').set('cookie', ada);
      expect(me.body.role).toBe('admin');
    } finally {
      server.close();
      built.close();
    }
  });

  it('production never bootstraps the first registrant as admin', () => {
    const cfg = loadConfig({ ...process.env, NODE_ENV: 'production', FOODI_BOOTSTRAP_FIRST_ADMIN: 'true', FOODI_COOKIE_SECURE: 'true' });
    expect(cfg.bootstrapFirstAdmin).toBe(false);
    expect(cfg.enableMockProvider).toBe(false);
  });

  it('an SSO account cannot squat an email another account uses', async () => {
    const b = await boot();
    try {
      const reg = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ email: 'victim@example.com', password: 'a long enough passphrase', displayName: 'Victim' });
      expect(reg.status).toBe(201);
      const sso = await signIn(b, 'mock-jo');
      const squat = await request(b.base).post('/api/auth/password').set('cookie', sso).set('origin', ORIGIN).send({ next: 'another long passphrase', email: 'victim@example.com' });
      expect(squat.status).toBe(409);
      await signIn(b, 'mock-sam');
      const squat2 = await request(b.base).post('/api/auth/password').set('cookie', sso).set('origin', ORIGIN).send({ next: 'another long passphrase', email: 'sam@example.com' });
      expect(squat2.status).toBe(409); // sam's OIDC email
      const own = await request(b.base).post('/api/auth/password').set('cookie', sso).set('origin', ORIGIN).send({ next: 'another long passphrase' });
      expect(own.status).toBe(200); // jo's own verified email is fine
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('admin post removal makes the recipe private again', async () => {
    const b = await boot();
    try {
      const admin = await signIn(b, 'mock-ada');
      const author = await signIn(b, 'mock-sam');
      await request(b.base).put('/api/profile').set('cookie', author).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', author).set('origin', ORIGIN).send({ prompt: 'anything' });
      const post = await request(b.base).post('/api/social/posts').set('cookie', author).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id, caption: 'x' });
      const viewer = await signIn(b, 'mock-priya');
      expect((await request(b.base).get(`/api/recipes/${gen.body.recipe.id}`).set('cookie', viewer)).status).toBe(200);
      await request(b.base).delete(`/api/admin/posts/${post.body.post.id}`).set('cookie', admin).set('origin', ORIGIN);
      expect((await request(b.base).get(`/api/recipes/${gen.body.recipe.id}`).set('cookie', viewer)).status).toBe(403);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('notifications', () => {
  it('likes, comments and saves notify the author (never yourself), and can be marked read', async () => {
    const b = await boot();
    try {
      const author = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', author).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', author).set('origin', ORIGIN).send({ prompt: 'anything' });
      const post = await request(b.base).post('/api/social/posts').set('cookie', author).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id, caption: '' });
      const pid = post.body.post.id;
      // Own like → no notification.
      await request(b.base).post(`/api/social/posts/${pid}/like`).set('cookie', author).set('origin', ORIGIN).send({ liked: true });
      expect((await request(b.base).get('/api/notifications/unread').set('cookie', author)).body.unread).toBe(0);

      const fan = await signIn(b, 'mock-sam');
      await request(b.base).post(`/api/social/posts/${pid}/like`).set('cookie', fan).set('origin', ORIGIN).send({ liked: true });
      await request(b.base).post(`/api/social/posts/${pid}/like`).set('cookie', fan).set('origin', ORIGIN).send({ liked: false });
      await request(b.base).post(`/api/social/posts/${pid}/like`).set('cookie', fan).set('origin', ORIGIN).send({ liked: true }); // no duplicate
      await request(b.base).post(`/api/social/posts/${pid}/comments`).set('cookie', fan).set('origin', ORIGIN).send({ body: 'Looks great' });
      await request(b.base).post(`/api/recipes/${gen.body.recipe.id}/save`).set('cookie', fan).set('origin', ORIGIN);

      // The feed carries the newest two comments on each post (oldest first) plus diet chips; the thread endpoint has them all.
      for (const body of ['Second', 'Third']) await request(b.base).post(`/api/social/posts/${pid}/comments`).set('cookie', author).set('origin', ORIGIN).send({ body });
      const feed = await request(b.base).get('/api/social/feed').set('cookie', fan);
      const inFeed = feed.body.items.find((i: { type: string; post?: { id: string } }) => i.type === 'post' && i.post?.id === pid).post;
      expect(inFeed.commentCount).toBe(3);
      expect(inFeed.latestComments.map((c: { body: string }) => c.body)).toEqual(['Second', 'Third']);
      expect(inFeed.latestComments[0].isMine).toBe(false);
      expect(Array.isArray(inFeed.recipe.dietLabels)).toBe(true);
      const thread = await request(b.base).get(`/api/social/posts/${pid}/comments`).set('cookie', fan);
      expect(thread.body.comments.map((c: { body: string }) => c.body)).toEqual(['Looks great', 'Second', 'Third']);
      expect(thread.body.comments[0].isMine).toBe(true);
      expect((await request(b.base).get('/api/social/posts/nope/comments').set('cookie', fan)).status).toBe(404);

      const list = await request(b.base).get('/api/notifications').set('cookie', author);
      expect(list.body.unread).toBe(3);
      expect(list.body.notifications.map((n: { kind: string }) => n.kind).sort()).toEqual(['comment', 'like', 'save']);
      expect(list.body.notifications[0].actor.handle).toBe('sam_rivera');

      const read = await request(b.base).post('/api/notifications/read').set('cookie', author).set('origin', ORIGIN).send({});
      expect(read.body.unread).toBe(0);
      // Sam's list is private to Sam.
      expect((await request(b.base).get('/api/notifications').set('cookie', fan)).body.notifications).toHaveLength(0);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('community', () => {
  it('follow → notification, following-scope feed, suggestions exclude people you follow', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      const priya = await signIn(b, 'mock-priya');
      for (const c of [ada, sam, priya]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);

      expect((await request(b.base).post('/api/social/follow/sam_rivera').set('cookie', sam).set('origin', ORIGIN).send({ follow: true })).status).toBe(400);
      const f = await request(b.base).post('/api/social/follow/ada_lovelace').set('cookie', sam).set('origin', ORIGIN).send({ follow: true });
      expect(f.body).toEqual({ following: true, followerCount: 1 });
      // Following twice is idempotent and notifies once.
      await request(b.base).post('/api/social/follow/ada_lovelace').set('cookie', sam).set('origin', ORIGIN).send({ follow: true });
      const adaNtf = await request(b.base).get('/api/notifications').set('cookie', ada);
      expect(adaNtf.body.notifications.filter((n: { kind: string }) => n.kind === 'follow')).toHaveLength(1);

      const prof = await request(b.base).get('/api/social/profiles/ada_lovelace').set('cookie', sam);
      expect(prof.body.profile.followerCount).toBe(1);
      expect(prof.body.profile.followedByMe).toBe(true);
      expect((await request(b.base).get('/api/social/profiles/ada_lovelace/followers').set('cookie', priya)).body.people.map((p: { handle: string }) => p.handle)).toEqual(['sam_rivera']);

      // Ada and Priya each share; Sam's "following" feed only has Ada's, and Sam hears about it.
      const gA = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'soup' });
      await request(b.base).post('/api/social/posts').set('cookie', ada).set('origin', ORIGIN).send({ recipeId: gA.body.recipe.id, caption: '' });
      const gP = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', priya).set('origin', ORIGIN).send({ prompt: 'salad' });
      await request(b.base).post('/api/social/posts').set('cookie', priya).set('origin', ORIGIN).send({ recipeId: gP.body.recipe.id, caption: '' });
      expect((await request(b.base).get('/api/social/feed').set('cookie', sam)).body.items).toHaveLength(2);
      const following = await request(b.base).get('/api/social/feed?scope=following').set('cookie', sam);
      expect(following.body.items).toHaveLength(1);
      expect(following.body.items[0].post.author.handle).toBe('ada_lovelace');
      expect((await request(b.base).get('/api/notifications').set('cookie', sam)).body.notifications.some((n: { kind: string }) => n.kind === 'post')).toBe(true);

      const sugg = await request(b.base).get('/api/social/suggestions').set('cookie', sam);
      const handles = sugg.body.people.map((p: { handle: string }) => p.handle);
      expect(handles).toContain('priya_nataraja');
      expect(handles).not.toContain('ada_lovelace');
      expect(handles).not.toContain('sam_rivera');

      const un = await request(b.base).post('/api/social/follow/ada_lovelace').set('cookie', sam).set('origin', ORIGIN).send({ follow: false });
      expect(un.body.followerCount).toBe(0);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('blog: drafts stay private, publishing shows in the feed, likes/comments notify, media follows the post', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'bread' });

      const draft = await request(b.base).post('/api/blog').set('cookie', ada).set('origin', ORIGIN).send({ title: 'On sourdough', body: '## Starter\n\nFeed it **daily**.', status: 'draft', recipeIds: [gen.body.recipe.id] });
      expect(draft.status).toBe(201);
      expect(draft.body.post.excerpt).toBe('Feed it daily.');
      const id = draft.body.post.id;
      expect((await request(b.base).get(`/api/blog/${id}`).set('cookie', sam)).status).toBe(404);
      expect((await request(b.base).get('/api/blog').set('cookie', sam)).body.posts).toHaveLength(0);
      // The attached private recipe is not leaked through the draft's recipe list either.
      expect((await request(b.base).get('/api/blog?author=ada_lovelace').set('cookie', ada)).body.posts[0].recipes).toHaveLength(1);

      const pub = await request(b.base).put(`/api/blog/${id}`).set('cookie', ada).set('origin', ORIGIN).send({ title: 'On sourdough', body: 'Feed it daily.', status: 'published' });
      expect(pub.body.post.status).toBe('published');
      expect(pub.body.post.publishedAt).toBeTruthy();
      const asSam = await request(b.base).get(`/api/blog/${id}`).set('cookie', sam);
      expect(asSam.status).toBe(200);
      expect(asSam.body.post.isMine).toBe(false);
      const feed = await request(b.base).get('/api/social/feed').set('cookie', sam);
      expect(feed.body.items[0].type).toBe('blog');

      await request(b.base).post(`/api/blog/${id}/like`).set('cookie', sam).set('origin', ORIGIN).send({ liked: true });
      const c = await request(b.base).post(`/api/blog/${id}/comments`).set('cookie', sam).set('origin', ORIGIN).send({ body: 'Nice' });
      expect(c.status).toBe(201);
      const ntf = await request(b.base).get('/api/notifications').set('cookie', ada);
      const kinds = ntf.body.notifications.filter((n: { blogId: string | null }) => n.blogId === id).map((n: { kind: string }) => n.kind).sort();
      expect(kinds).toEqual(['comment', 'like']);
      expect(ntf.body.notifications[0].blogTitle).toBe('On sourdough');

      // Only the author (or an admin) can edit / delete.
      expect((await request(b.base).put(`/api/blog/${id}`).set('cookie', sam).set('origin', ORIGIN).send({ title: 'x', body: 'y' })).status).toBe(403);
      expect((await request(b.base).delete(`/api/blog/${id}`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(403);
      expect((await request(b.base).delete(`/api/blog/comments/${c.body.comment.id}`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      expect((await request(b.base).delete(`/api/blog/${id}`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      expect((await request(b.base).get(`/api/blog/${id}`).set('cookie', ada)).status).toBe(404);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('recipe books: private books hide, public ones show on the profile, adding someone’s recipe tells them', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'curry' });
      const rid = gen.body.recipe.id;

      const book = await request(b.base).post('/api/books').set('cookie', sam).set('origin', ORIGIN).send({ name: 'Weeknights', emoji: '🍝' });
      expect(book.status).toBe(201);
      const bid = book.body.book.id;
      // Ada's recipe is private, so Sam can't shelve it yet.
      expect((await request(b.base).post(`/api/books/${bid}/items`).set('cookie', sam).set('origin', ORIGIN).send({ recipeId: rid })).status).toBe(404);
      await request(b.base).post('/api/social/posts').set('cookie', ada).set('origin', ORIGIN).send({ recipeId: rid, caption: '' });
      const add = await request(b.base).post(`/api/books/${bid}/items`).set('cookie', sam).set('origin', ORIGIN).send({ recipeId: rid, note: 'Double the chilli' });
      expect(add.status).toBe(201);
      expect((await request(b.base).get('/api/notifications').set('cookie', ada)).body.notifications[0]).toMatchObject({ kind: 'book', bookName: 'Weeknights' });

      const detail = await request(b.base).get(`/api/books/${bid}`).set('cookie', ada);
      expect(detail.status).toBe(200);
      expect(detail.body.items[0]).toMatchObject({ recipeId: rid, note: 'Double the chilli', author: { handle: 'ada_lovelace' } });
      expect((await request(b.base).get(`/api/books?recipeId=${rid}`).set('cookie', sam)).body.books[0].contains).toBe(true);

      // Private books vanish from other people's view of the profile and the direct URL.
      await request(b.base).put(`/api/books/${bid}`).set('cookie', sam).set('origin', ORIGIN).send({ name: 'Weeknights', emoji: '🍝', visibility: 'private' });
      expect((await request(b.base).get(`/api/books/${bid}`).set('cookie', ada)).status).toBe(404);
      expect((await request(b.base).get('/api/social/profiles/sam_rivera').set('cookie', ada)).body.books).toHaveLength(0);
      expect((await request(b.base).get('/api/social/profiles/sam_rivera').set('cookie', sam)).body.books).toHaveLength(1);
      expect((await request(b.base).put(`/api/books/${bid}`).set('cookie', ada).set('origin', ORIGIN).send({ name: 'Mine now' })).status).toBe(404);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('adapting a shared recipe makes an editable copy that credits the original', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'tacos' });
      const rid = gen.body.recipe.id;
      expect((await request(b.base).post(`/api/recipes/${rid}/adapt`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(403);
      await request(b.base).post('/api/social/posts').set('cookie', ada).set('origin', ORIGIN).send({ recipeId: rid, caption: '' });

      const fork = await request(b.base).post(`/api/recipes/${rid}/adapt`).set('cookie', sam).set('origin', ORIGIN);
      expect(fork.status).toBe(201);
      const copy = await request(b.base).get(`/api/recipes/${fork.body.id}`).set('cookie', sam);
      expect(copy.body.isMine).toBe(true);
      expect(copy.body.source).toBe('user');
      expect(copy.body.recipe.adaptedFrom).toMatchObject({ id: rid, handle: 'ada_lovelace', stillPublic: true });
      expect((await request(b.base).get('/api/notifications').set('cookie', ada)).body.notifications[0].kind).toBe('remix');

      // Edit the copy (a generated original could not be edited by hand) with notes on what changed.
      const content = copy.body.recipe.content;
      const edited = await request(b.base)
        .put(`/api/recipes/${fork.body.id}`)
        .set('cookie', sam)
        .set('origin', ORIGIN)
        .send({ ...content, title: 'Tacos, but spicier', revisionNotes: 'Doubled the chipotle, swapped cheddar for cotija.' });
      expect(edited.status).toBe(200);
      expect(edited.body.recipe.content.title).toBe('Tacos, but spicier');
      expect(edited.body.recipe.revisionNotes).toMatch(/chipotle/);
      expect((await request(b.base).get(`/api/recipes/${rid}`).set('cookie', ada)).body.recipe.adaptationCount).toBe(1);

      // Re-sharing carries the credit onto the post.
      const post = await request(b.base).post('/api/social/posts').set('cookie', sam).set('origin', ORIGIN).send({ recipeId: fork.body.id, caption: 'My take' });
      expect(post.body.post.recipe.adaptedFrom).toMatchObject({ id: rid, title: content.title, handle: 'ada_lovelace' });
      // The original disappearing keeps the credit but drops the link.
      await request(b.base).delete(`/api/recipes/${rid}`).set('cookie', ada).set('origin', ORIGIN);
      expect((await request(b.base).get(`/api/recipes/${fork.body.id}`).set('cookie', sam)).body.recipe.adaptedFrom).toMatchObject({ id: null, handle: 'ada_lovelace', stillPublic: false });
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('notification stream pushes the unread count live', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      const events: string[] = [];
      const ac = new AbortController();
      const res = await fetch(`${b.base}/api/notifications/stream`, { headers: { cookie: ada }, signal: ac.signal });
      expect(res.headers.get('content-type')).toContain('text/event-stream');
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const pump = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          events.push(dec.decode(value));
          if (events.join('').includes('event: notification')) break;
        }
      })();
      await request(b.base).post('/api/social/follow/ada_lovelace').set('cookie', sam).set('origin', ORIGIN).send({ follow: true });
      await Promise.race([pump, new Promise((_, rej) => setTimeout(() => rej(new Error('no event within 3s')), 3000))]);
      const text = events.join('');
      expect(text).toContain('event: unread');
      expect(text).toContain('event: notification');
      expect(text).toContain('"kind":"follow"');
      ac.abort();
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('remembers the tail of a connected API key so people can tell keys apart', async () => {
    // A stand-in for api.anthropic.com that accepts any key.
    const vendor = createServer((_req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end('{"data":[]}')).listen(0);
    const vendorPort = (vendor.address() as { port: number }).port;
    const b = await boot({ ANTHROPIC_API_BASE: `http://127.0.0.1:${vendorPort}` });
    try {
      const me = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ email: 'key@example.com', password: 'correct horse battery', displayName: 'Kay' });
      const cookie = (me.headers['set-cookie'] as unknown as string[]).map((c) => c.split(';')[0]!).find((c) => c.startsWith('foodi_session='))!;
      const key = await request(b.base).post('/api/auth/key').set('cookie', cookie).set('origin', ORIGIN).send({ vendor: 'anthropic', apiKey: 'sk-ant-api03-mock-abcdefghijklmnopqrstuvwxyz-Zz9Q' });
      expect(key.status).toBe(200);
      expect(key.body.credentialHint).toBe('Zz9Q');
      expect(key.body.credentialUpdatedAt).toBeTruthy();
      await request(b.base).delete('/api/auth/key').set('cookie', cookie).set('origin', ORIGIN);
      expect((await request(b.base).get('/api/auth/me').set('cookie', cookie)).body.credentialHint).toBeNull();
    } finally {
      vendor.close();
      b.server.close();
      b.close();
    }
  });
});

describe('admin community', () => {
  it('lists recipe-post and blog comments together and deletes either kind', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'x' });
      const post = await request(b.base).post('/api/social/posts').set('cookie', ada).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id, caption: '' });
      const blog = await request(b.base).post('/api/blog').set('cookie', ada).set('origin', ORIGIN).send({ title: 'T', body: 'b', status: 'published' });
      await request(b.base).post(`/api/social/posts/${post.body.post.id}/comments`).set('cookie', sam).set('origin', ORIGIN).send({ body: 'on the post' });
      const bc = await request(b.base).post(`/api/blog/${blog.body.post.id}/comments`).set('cookie', sam).set('origin', ORIGIN).send({ body: 'on the blog' });
      const list = await request(b.base).get('/api/admin/comments').set('cookie', ada);
      expect(list.status).toBe(200);
      expect(list.body.comments).toHaveLength(2);
      const byBody = (body: string) => list.body.comments.find((c: { body: string }) => c.body === body);
      expect(byBody('on the blog')).toMatchObject({ blogId: blog.body.post.id, postId: null });
      expect(byBody('on the post')).toMatchObject({ postId: post.body.post.id, blogId: null });
      expect((await request(b.base).delete(`/api/admin/comments/${bc.body.comment.id}`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      expect((await request(b.base).get('/api/admin/comments').set('cookie', ada)).body.comments).toHaveLength(1);
      expect((await request(b.base).get('/api/admin/blog').set('cookie', ada)).body.posts).toHaveLength(1);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('security review 2', () => {
  it('a recipe that goes private after being shelved shows only its snapshot title, never current content', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'stew' });
      const rid = gen.body.recipe.id;
      const originalTitle = gen.body.recipe.content.title;
      const post = await request(b.base).post('/api/social/posts').set('cookie', ada).set('origin', ORIGIN).send({ recipeId: rid, caption: '' });
      const book = await request(b.base).post('/api/books').set('cookie', sam).set('origin', ORIGIN).send({ name: 'Stews' });
      await request(b.base).post(`/api/books/${book.body.book.id}/items`).set('cookie', sam).set('origin', ORIGIN).send({ recipeId: rid });
      // Ada takes the post down (recipe goes private) — then edits it via adapt? No: AI recipes are edited with Adjust; simulate a title change directly.
      await request(b.base).delete(`/api/social/posts/${post.body.post.id}`).set('cookie', ada).set('origin', ORIGIN);
      b.db.prepare(`UPDATE recipes SET title = 'Secret new title', content = json_set(content, '$.title', 'Secret new title', '$.summary', 'private notes') WHERE id = ?`).run(rid);

      const asOwner = await request(b.base).get(`/api/books/${book.body.book.id}`).set('cookie', sam);
      expect(asOwner.body.items).toHaveLength(1);
      expect(asOwner.body.items[0]).toMatchObject({ available: false, title: originalTitle, summary: '', cover: null });
      expect(JSON.stringify(asOwner.body)).not.toContain('Secret new title');
      expect(asOwner.body.book.peek).toEqual([]);
      // Anyone else doesn't see the row at all.
      const priya = await signIn(b, 'mock-priya');
      expect((await request(b.base).get(`/api/books/${book.body.book.id}`).set('cookie', priya)).body.items).toHaveLength(0);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('one email, one account: a password registration cannot shadow an SSO account’s email', async () => {
    const b = await boot();
    try {
      await signIn(b, 'mock-sam'); // sam@example.com, verified by the mock IdP
      const dup = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ email: 'sam@example.com', password: 'correct horse battery', displayName: 'Impostor' });
      expect(dup.status).toBe(409);
      expect(b.db.prepare(`SELECT COUNT(*) AS n FROM users WHERE lower(email) = 'sam@example.com'`).get()).toEqual({ n: 1 });
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('unpublished blog titles and private book names drop out of other people’s notifications', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      await request(b.base).post('/api/social/follow/ada_lovelace').set('cookie', sam).set('origin', ORIGIN).send({ follow: true });
      const blog = await request(b.base).post('/api/blog').set('cookie', ada).set('origin', ORIGIN).send({ title: 'Public title', body: 'x', status: 'published' });
      expect((await request(b.base).get('/api/notifications').set('cookie', sam)).body.notifications[0].blogTitle).toBe('Public title');
      await request(b.base).put(`/api/blog/${blog.body.post.id}`).set('cookie', ada).set('origin', ORIGIN).send({ title: 'Now secret', body: 'x', status: 'draft' });
      expect((await request(b.base).get('/api/notifications').set('cookie', sam)).body.notifications[0].blogTitle).toBeNull();
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('house kitchen', () => {
  it('seeds 50+ varied public recipes and books under @foodi on boot, backfills the feed, and drips the rest', async () => {
    const b = await boot({ FOODI_HOUSE_KITCHEN: 'true' });
    try {
      const houseId = b.house.account().id;
      const recipes = b.db.prepare('SELECT title, content FROM recipes WHERE user_id = ?').all(houseId) as { title: string; content: string }[];
      expect(recipes.length).toBeGreaterThanOrEqual(50);
      const contents = recipes.map((r) => JSON.parse(r.content) as { dietLabels: string[]; mealType: string; cuisine: string; allergens: string[]; ingredients: { ingredientId: string | null }[] });
      // Variety: every meal type, many cuisines, and the big dietary buckets are all covered.
      expect(new Set(contents.map((c) => c.mealType)).size).toBe(7);
      expect(new Set(contents.map((c) => c.cuisine)).size).toBeGreaterThanOrEqual(15);
      for (const label of ['vegan', 'vegetarian', 'gluten-free', 'dairy-free', 'nut-free', 'pescatarian', 'keto-friendly', 'high-protein', 'halal', 'kosher']) {
        expect(contents.filter((c) => c.dietLabels.includes(label)).length).toBeGreaterThan(0);
      }
      // Ingredients link to the library so allergen badges and substitutes work.
      const linked = contents.flatMap((c) => c.ingredients).filter((i) => i.ingredientId).length;
      const total = contents.flatMap((c) => c.ingredients).length;
      expect(linked / total).toBeGreaterThan(0.75);
      // Idempotent: a second boot adds nothing.
      expect(b.house.ensure().added).toBe(0);
      expect((b.db.prepare('SELECT COUNT(*) AS n FROM recipe_books WHERE owner_id = ?').get(houseId) as { n: number }).n).toBe(6);

      // Feed is pre-populated, and the house posts are visible to a fresh user.
      const sam = await signIn(b, 'mock-sam');
      const feed = await request(b.base).get('/api/social/feed').set('cookie', sam);
      expect(feed.body.items.length).toBe(20);
      const house = feed.body.items.find((i: { type: string; post?: { isHouse: boolean } }) => i.type === 'post' && i.post?.isHouse);
      expect(house).toBeTruthy();
      expect(house.post.commentsEnabled).toBe(false);
      // Likes and saves work; comments are refused.
      expect((await request(b.base).post(`/api/social/posts/${house.post.id}/like`).set('cookie', sam).set('origin', ORIGIN).send({ liked: true })).body.likeCount).toBe(1);
      expect((await request(b.base).post(`/api/recipes/${house.post.recipe.id}/save`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(201);
      expect((await request(b.base).post(`/api/recipes/${house.post.recipe.id}/adapt`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(201);
      expect((await request(b.base).post(`/api/social/posts/${house.post.id}/comments`).set('cookie', sam).set('origin', ORIGIN).send({ body: 'hi' })).status).toBe(403);
      // Nobody is notified on the house's behalf.
      expect((b.db.prepare('SELECT COUNT(*) AS n FROM notifications WHERE user_id = ?').get(houseId) as { n: number }).n).toBe(0);

      // The drip: with posts per day > 0 and the last post in the past, one unposted recipe goes out.
      const before = (b.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?').get(houseId) as { n: number }).n;
      expect(b.house.tick()).toBe(true);
      expect((b.db.prepare('SELECT COUNT(*) AS n FROM posts WHERE author_id = ?').get(houseId) as { n: number }).n).toBe(before + 1);
      expect(b.house.tick()).toBe(false); // too soon for another
      // The profile shows the books, and the house account can't be made admin.
      const prof = await request(b.base).get('/api/social/profiles/foodi').set('cookie', sam);
      expect(prof.body.books.length).toBe(6);
      const ada = await signIn(b, 'mock-ada');
      expect((await request(b.base).patch(`/api/admin/users/${houseId}`).set('cookie', ada).set('origin', ORIGIN).send({ role: 'admin' })).status).toBe(400);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('commerce (test payment provider)', () => {
  async function bookWithRecipes(b: Booted, cookie: string, n: number) {
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', cookie).set('origin', ORIGIN).send({ prompt: `dish ${i}` });
      ids.push(gen.body.recipe.id);
    }
    const book = await request(b.base).post('/api/books').set('cookie', cookie).set('origin', ORIGIN).send({ name: 'Paid book', emoji: '💵', visibility: 'public' });
    for (const id of ids) {
      const r = await request(b.base).post(`/api/books/${book.body.book.id}/items`).set('cookie', cookie).set('origin', ORIGIN).send({ recipeId: id });
      if (r.status >= 300) throw new Error(`add item ${id}: ${r.status} ${JSON.stringify(r.body)}`);
    }
    return { bookId: book.body.book.id as string, recipeIds: ids };
  }

  it('sells a book: preview for browsers, full access after a test checkout, earnings, payout, refund', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const { bookId, recipeIds } = await bookWithRecipes(b, ada, 3);
      const cfg = await request(b.base).get('/api/commerce/config').set('cookie', sam);
      expect(cfg.body.testMode).toBe(true);

      const sale = await request(b.base).put(`/api/commerce/books/${bookId}/sale`).set('cookie', ada).set('origin', ORIGIN).send({ forSale: true, priceCents: 999, salesPitch: 'Three dinners.', previewCount: 2 });
      expect(sale.status).toBe(200);
      // Browsing: two previews, one locked; the locked recipe itself is not readable.
      const peek = await request(b.base).get(`/api/books/${bookId}`).set('cookie', sam);
      expect(peek.body.book).toMatchObject({ forSale: true, priceCents: 999, purchased: false });
      expect(peek.body.items.map((i: { locked: boolean }) => i.locked)).toEqual([false, false, true]);
      expect((await request(b.base).get(`/api/recipes/${recipeIds[2]}`).set('cookie', sam)).status).toBe(403);
      // Can't buy your own, can't add someone else's recipe to a for-sale book.
      expect((await request(b.base).post(`/api/commerce/books/${bookId}/buy`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(400);

      const buy = await request(b.base).post(`/api/commerce/books/${bookId}/buy`).set('cookie', sam).set('origin', ORIGIN);
      expect(buy.status).toBe(200);
      const m = /\/pay\/test\/book\/(pur_[A-Za-z0-9_-]+)$/.exec(buy.body.url);
      expect(m).toBeTruthy();
      const purchaseId = m![1]!;
      // Only the buyer can see or complete the order.
      expect((await request(b.base).get(`/api/commerce/pay/test/book/${purchaseId}`).set('cookie', ada)).status).toBe(404);
      const order = await request(b.base).get(`/api/commerce/pay/test/book/${purchaseId}`).set('cookie', sam);
      expect(order.body).toMatchObject({ amountCents: 999, status: 'pending' });
      const done = await request(b.base).post(`/api/commerce/pay/test/book/${purchaseId}/complete`).set('cookie', sam).set('origin', ORIGIN);
      expect(done.status).toBe(200);
      // Second completion is a no-op, not a double sale.
      await request(b.base).post(`/api/commerce/pay/test/book/${purchaseId}/complete`).set('cookie', sam).set('origin', ORIGIN);

      const owned = await request(b.base).get(`/api/books/${bookId}`).set('cookie', sam);
      expect(owned.body.book.purchased).toBe(true);
      expect(owned.body.items.every((i: { locked: boolean }) => !i.locked)).toBe(true);
      expect((await request(b.base).get(`/api/recipes/${recipeIds[2]}`).set('cookie', sam)).status).toBe(200);
      expect((await request(b.base).get('/api/commerce/library').set('cookie', sam)).body.bookIds).toEqual([bookId]);
      expect((await request(b.base).post(`/api/commerce/books/${bookId}/buy`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(409);
      // Seller side: one sale, 20% fee, payout request.
      const e1 = await request(b.base).get('/api/commerce/earnings').set('cookie', ada);
      expect(e1.body).toMatchObject({ salesCount: 1, grossCents: 999, feesCents: 200, netCents: 799, availableCents: 799 });
      expect((await request(b.base).get('/api/notifications').set('cookie', ada)).body.notifications[0].kind).toBe('sale');
      const payout = await request(b.base).post('/api/commerce/payouts').set('cookie', ada).set('origin', ORIGIN);
      expect(payout.status).toBe(201);
      expect(payout.body.payout.amountCents).toBe(799);
      expect((await request(b.base).post('/api/commerce/payouts').set('cookie', ada).set('origin', ORIGIN)).status).toBe(409);
      // The book can't be deleted while people have paid for it.
      expect((await request(b.base).delete(`/api/books/${bookId}`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(409);

      // Admin: sees it all, pays the payout, then refunds the purchase (access is revoked).
      const admin = await request(b.base).get('/api/admin/commerce').set('cookie', ada);
      expect(admin.body.stats).toMatchObject({ purchases: 1, salesGrossCents: 999, platformFeesCents: 200, pendingPayouts: 1, pendingPayoutCents: 799, booksForSale: 1 });
      expect(admin.body.provider.id).toBe('test');
      await request(b.base).post(`/api/admin/commerce/payouts/${payout.body.payout.id}`).set('cookie', ada).set('origin', ORIGIN).send({ status: 'paid', note: 'Sent by e-transfer' });
      const e2 = await request(b.base).get('/api/commerce/earnings').set('cookie', ada);
      expect(e2.body).toMatchObject({ paidOutCents: 799, availableCents: 0 });
      expect((await request(b.base).post(`/api/admin/commerce/purchases/${purchaseId}/refund`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      expect((await request(b.base).get(`/api/recipes/${recipeIds[2]}`).set('cookie', sam)).status).toBe(403);
      expect((await request(b.base).get('/api/commerce/earnings').set('cookie', ada)).body.salesCount).toBe(0);
      // Consumers can't reach the admin commerce panel.
      expect((await request(b.base).get('/api/admin/commerce').set('cookie', sam)).status).toBe(403);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('refuses to sell a book containing someone else’s recipe', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', sam).set('origin', ORIGIN).send({ prompt: 'x' });
      await request(b.base).post('/api/social/posts').set('cookie', sam).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id, caption: '' });
      const book = await request(b.base).post('/api/books').set('cookie', ada).set('origin', ORIGIN).send({ name: 'Mixed', visibility: 'public' });
      await request(b.base).post(`/api/books/${book.body.book.id}/items`).set('cookie', ada).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id });
      const sale = await request(b.base).put(`/api/commerce/books/${book.body.book.id}/sale`).set('cookie', ada).set('origin', ORIGIN).send({ forSale: true, priceCents: 500 });
      expect(sale.status).toBe(400);
      expect(sale.body.error.message).toMatch(/your own recipes/);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('promotes a book: paid placement lands in the feed and rail, tracks clicks, and admins can stop it', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      const sam = await signIn(b, 'mock-sam');
      for (const c of [ada, sam]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const { bookId } = await bookWithRecipes(b, ada, 1);
      // Something in the feed so there's a slot to fill.
      const gen = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', sam).set('origin', ORIGIN).send({ prompt: 'y' });
      await request(b.base).post('/api/social/posts').set('cookie', sam).set('origin', ORIGIN).send({ recipeId: gen.body.recipe.id, caption: '' });

      expect((await request(b.base).post(`/api/commerce/books/${bookId}/promote`).set('cookie', sam).set('origin', ORIGIN).send({ packageId: 'boost-3' })).status).toBe(404);
      const promo = await request(b.base).post(`/api/commerce/books/${bookId}/promote`).set('cookie', ada).set('origin', ORIGIN).send({ packageId: 'feature-7' });
      expect(promo.status).toBe(200);
      const id = /\/pay\/test\/promo\/(prm_[A-Za-z0-9_-]+)$/.exec(promo.body.url)![1]!;
      expect((await request(b.base).get('/api/commerce/featured').set('cookie', sam)).body.promotions).toHaveLength(0);
      await request(b.base).post(`/api/commerce/pay/test/promo/${id}/complete`).set('cookie', ada).set('origin', ORIGIN);

      const feed = await request(b.base).get('/api/social/feed').set('cookie', sam);
      const kinds = feed.body.items.map((i: { type: string }) => i.type);
      expect(kinds).toContain('promo');
      expect(kinds).toContain('book');
      const slot = feed.body.items.find((i: { type: string }) => i.type === 'promo');
      expect(slot.promotion).toMatchObject({ packageId: 'feature-7', status: 'active', book: { id: bookId } });
      expect((await request(b.base).get('/api/commerce/featured').set('cookie', sam)).body.promotions[0].id).toBe(id);
      await request(b.base).post(`/api/commerce/promotions/${id}/click`).set('cookie', sam).set('origin', ORIGIN);
      const mine = await request(b.base).get('/api/commerce/earnings').set('cookie', ada);
      expect(mine.body.promotions[0]).toMatchObject({ id, clicks: 1, status: 'active' });
      expect(mine.body.promotions[0].impressions).toBeGreaterThanOrEqual(1);
      expect(mine.body.spentOnPromotionsCents).toBe(1499);
      expect((await request(b.base).get(`/api/books/${bookId}`).set('cookie', sam)).body.book.promoted).toBe(true);
      // One live promotion per book at a time.
      expect((await request(b.base).post(`/api/commerce/books/${bookId}/promote`).set('cookie', ada).set('origin', ORIGIN).send({ packageId: 'boost-3' })).status).toBe(409);

      await request(b.base).post(`/api/admin/commerce/promotions/${id}/cancel`).set('cookie', ada).set('origin', ORIGIN);
      expect((await request(b.base).get('/api/commerce/featured').set('cookie', sam)).body.promotions).toHaveLength(0);
      expect((await request(b.base).get('/api/social/feed').set('cookie', sam)).body.items.some((i: { type: string }) => i.type === 'promo')).toBe(false);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('verifies Stripe webhook signatures and rejects everything else', async () => {
    const { verifyStripeWebhook } = await import('./payments/stripe.js');
    const { createHmac } = await import('node:crypto');
    const secret = 'whsec_test';
    const body = Buffer.from(JSON.stringify({ type: 'checkout.session.completed', data: { object: { id: 'cs_1', payment_status: 'paid', metadata: { kind: 'book', refId: 'pur_x' } } } }));
    const t = Math.floor(Date.now() / 1000);
    const sig = createHmac('sha256', secret).update(`${t}.${body.toString()}`).digest('hex');
    expect(verifyStripeWebhook(body, `t=${t},v1=${sig}`, secret)?.type).toBe('checkout.session.completed');
    expect(verifyStripeWebhook(body, `t=${t},v1=${sig.replace(/^./, sig[0] === 'a' ? 'b' : 'a')}`, secret)).toBeNull();
    expect(verifyStripeWebhook(body, `t=${t - 1000},v1=${sig}`, secret)).toBeNull();
    expect(verifyStripeWebhook(body, undefined, secret)).toBeNull();
    // The route itself refuses unsigned posts.
    const b = await boot();
    try {
      expect((await request(b.base).post('/api/payments/stripe/webhook').set('content-type', 'application/json').send(body.toString())).status).toBe(503);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('shop', () => {
  it('listings need approval by an admin with the posting-approvals permission; buying, stock, fulfilment and refunds', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada'); // admin, no permissions yet
      const sam = await signIn(b, 'mock-sam');
      const jo = await signIn(b, 'mock-jo');
      for (const c of [ada, sam, jo]) await request(b.base).put('/api/profile').set('cookie', c).set('origin', ORIGIN).send(PROFILE);
      const adaId = (await request(b.base).get('/api/auth/me').set('cookie', ada)).body.id as string;

      // Sam lists a jar of chilli crisp with a photo.
      const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
      const up = await request(b.base).post('/api/media').set('cookie', sam).set('origin', ORIGIN).set('content-type', 'image/png').send(png);
      expect(up.status).toBe(201);
      const create = await request(b.base)
        .post('/api/shop')
        .set('cookie', sam)
        .set('origin', ORIGIN)
        .send({ title: 'Chilli crisp, small batch', description: 'Made every Sunday. Sichuan pepper, garlic, shallots.', category: 'ingredients', priceCents: 1200, quantity: 3, shipsFrom: 'Toronto', mediaIds: [up.body.media.id] });
      expect(create.status).toBe(201);
      const id = create.body.listing.id;
      expect(create.body.listing.status).toBe('pending');
      // Not in the shop, not visible to others, but the seller can see it.
      expect((await request(b.base).get('/api/shop').set('cookie', jo)).body.listings).toHaveLength(0);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', jo)).status).toBe(404);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', sam)).status).toBe(200);
      expect((await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', jo)).status).toBe(404);

      // Ada is an admin but lacks the permission: she sees the queue, cannot approve.
      const queue = await request(b.base).get('/api/admin/shop?status=pending').set('cookie', ada);
      expect(queue.body).toMatchObject({ pending: 1, canApprove: false });
      const denied = await request(b.base).post(`/api/admin/shop/${id}/review`).set('cookie', ada).set('origin', ORIGIN).send({ decision: 'approve' });
      expect(denied.status).toBe(403);
      expect(denied.body.error.message).toMatch(/posting-approvals/);
      // Consumers can't even see the queue, or grant permissions.
      expect((await request(b.base).get('/api/admin/shop').set('cookie', sam)).status).toBe(403);
      expect((await request(b.base).put(`/api/admin/users/${adaId}/permissions`).set('cookie', sam).set('origin', ORIGIN).send({ permissions: ['posting-approvals'] })).status).toBe(403);
      // Grant it (to a consumer it's refused), then approve.
      const samId = (await request(b.base).get('/api/auth/me').set('cookie', sam)).body.id as string;
      expect((await request(b.base).put(`/api/admin/users/${samId}/permissions`).set('cookie', ada).set('origin', ORIGIN).send({ permissions: ['posting-approvals'] })).status).toBe(400);
      const grant = await request(b.base).put(`/api/admin/users/${adaId}/permissions`).set('cookie', ada).set('origin', ORIGIN).send({ permissions: ['posting-approvals'] });
      expect(grant.body.permissions).toEqual(['posting-approvals']);
      expect((await request(b.base).get('/api/auth/me').set('cookie', ada)).body.permissions).toEqual(['posting-approvals']);
      expect((await request(b.base).post(`/api/admin/shop/${id}/review`).set('cookie', ada).set('origin', ORIGIN).send({ decision: 'reject' })).status).toBe(400); // needs a reason
      expect((await request(b.base).post(`/api/admin/shop/${id}/review`).set('cookie', ada).set('origin', ORIGIN).send({ decision: 'approve' })).status).toBe(200);
      expect((await request(b.base).get('/api/notifications').set('cookie', sam)).body.notifications[0].kind).toBe('listing');

      // Live: in the shop, searchable, photo visible.
      const shop = await request(b.base).get('/api/shop?category=ingredients&q=crisp').set('cookie', jo);
      expect(shop.body.listings).toHaveLength(1);
      expect((await request(b.base).get(`/api/media/${up.body.media.id}`).set('cookie', jo)).status).toBe(200);

      // Jo buys two; stock drops to one when the payment lands; the seller is told and marks it sent.
      expect((await request(b.base).post(`/api/shop/${id}/buy`).set('cookie', sam).set('origin', ORIGIN).send({ quantity: 1 })).status).toBe(400);
      expect((await request(b.base).post(`/api/shop/${id}/buy`).set('cookie', jo).set('origin', ORIGIN).send({ quantity: 5 })).status).toBe(409);
      const buy = await request(b.base).post(`/api/shop/${id}/buy`).set('cookie', jo).set('origin', ORIGIN).send({ quantity: 2, note: 'Leave with the concierge' });
      expect(buy.status).toBe(200);
      const orderId = /\/pay\/test\/order\/(ord_[A-Za-z0-9_-]+)$/.exec(buy.body.url)![1]!;
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', jo)).body.listing.quantity).toBe(3);
      await request(b.base).post(`/api/commerce/pay/test/order/${orderId}/complete`).set('cookie', jo).set('origin', ORIGIN);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', jo)).body.listing).toMatchObject({ quantity: 1, soldCount: 2 });
      const selling = await request(b.base).get('/api/shop/orders?role=selling').set('cookie', sam);
      expect(selling.body.orders[0]).toMatchObject({ id: orderId, status: 'paid', quantity: 2, amountCents: 2400, note: 'Leave with the concierge' });
      expect((await request(b.base).get('/api/notifications').set('cookie', sam)).body.notifications[0].kind).toBe('order');
      expect((await request(b.base).post(`/api/shop/orders/${orderId}/fulfil`).set('cookie', jo).set('origin', ORIGIN)).status).toBe(404);
      expect((await request(b.base).post(`/api/shop/orders/${orderId}/fulfil`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(200);
      expect((await request(b.base).get('/api/shop/orders').set('cookie', jo)).body.orders[0].status).toBe('fulfilled');
      // Earnings count it (20% fee).
      expect((await request(b.base).get('/api/commerce/earnings').set('cookie', sam)).body).toMatchObject({ salesCount: 1, grossCents: 2400, feesCents: 480 });

      // The last one sells out; a refund restocks it.
      const buy2 = await request(b.base).post(`/api/shop/${id}/buy`).set('cookie', jo).set('origin', ORIGIN).send({ quantity: 1 });
      const order2 = /\/(ord_[A-Za-z0-9_-]+)$/.exec(buy2.body.url)![1]!;
      await request(b.base).post(`/api/commerce/pay/test/order/${order2}/complete`).set('cookie', jo).set('origin', ORIGIN);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', jo)).body.listing.status).toBe('sold_out');
      expect((await request(b.base).get('/api/shop').set('cookie', jo)).body.listings).toHaveLength(0);
      await request(b.base).post(`/api/admin/commerce/orders/${order2}/refund`).set('cookie', ada).set('origin', ORIGIN);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', jo)).body.listing).toMatchObject({ status: 'approved', quantity: 1 });

      // Editing sends it back to review; a takedown needs only the admin role.
      await request(b.base).put(`/api/shop/${id}`).set('cookie', sam).set('origin', ORIGIN).send({ title: 'Chilli crisp, extra hot', description: 'Now with more Sichuan pepper in it.', category: 'ingredients', priceCents: 1300, quantity: 1, mediaIds: [up.body.media.id] });
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', sam)).body.listing.status).toBe('pending');
      await request(b.base).post(`/api/admin/shop/${id}/review`).set('cookie', ada).set('origin', ORIGIN).send({ decision: 'approve' });
      // Demoting Ada wipes her permissions; re-promoting doesn't restore them.
      const priya = await signIn(b, 'mock-priya');
      const priyaId = (await request(b.base).get('/api/auth/me').set('cookie', priya)).body.id as string;
      await request(b.base).patch(`/api/admin/users/${priyaId}`).set('cookie', ada).set('origin', ORIGIN).send({ role: 'admin' });
      await request(b.base).patch(`/api/admin/users/${adaId}`).set('cookie', priya).set('origin', ORIGIN).send({ role: 'consumer' });
      await request(b.base).patch(`/api/admin/users/${adaId}`).set('cookie', priya).set('origin', ORIGIN).send({ role: 'admin' });
      expect((await request(b.base).get('/api/auth/me').set('cookie', ada)).body.permissions).toEqual([]);
      expect((await request(b.base).post(`/api/admin/shop/${id}/takedown`).set('cookie', priya).set('origin', ORIGIN).send({ reason: 'Counterfeit labels' })).status).toBe(200);
      expect((await request(b.base).get(`/api/shop/${id}`).set('cookie', sam)).body.listing).toMatchObject({ status: 'rejected', rejectionReason: 'Counterfeit labels' });
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('generation jobs', () => {
  it('queues a generation, streams job events, saves the recipe and notifies', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      // Listen to the stream first so we see the job go queued → running → done.
      const seen: string[] = [];
      const ac = new AbortController();
      const res = await fetch(`${b.base}/api/notifications/stream`, { headers: { cookie: ada }, signal: ac.signal });
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      const pump = (async () => {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) break;
          seen.push(dec.decode(value));
          if (seen.join('').includes('"status":"done"')) break;
        }
      })();

      const q = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'weeknight noodles' });
      expect(q.status).toBe(202);
      expect(q.body.job).toMatchObject({ kind: 'generate', prompt: 'weeknight noodles', attempts: 0 });
      expect(['queued', 'running']).toContain(q.body.job.status);
      await Promise.race([pump, new Promise((_, rej) => setTimeout(() => rej(new Error('no done event within 5s')), 5000))]);
      ac.abort();
      const text = seen.join('');
      expect(text).toContain('event: job');
      expect(text).toContain('"status":"running"');
      expect(text).toContain('"status":"done"');

      await b.jobs.idle();
      const job = await request(b.base).get(`/api/recipes/jobs/${q.body.job.id}`).set('cookie', ada);
      expect(job.body.job).toMatchObject({ status: 'done', attempts: 1 });
      expect(job.body.job.recipeId).toMatch(/^rcp_/);
      expect(job.body.job.recipeTitle).toBeTruthy();
      expect((await request(b.base).get(`/api/recipes/${job.body.job.recipeId}`).set('cookie', ada)).status).toBe(200);
      const ntf = await request(b.base).get('/api/notifications').set('cookie', ada);
      expect(ntf.body.notifications[0]).toMatchObject({ kind: 'recipe', recipeId: job.body.job.recipeId });
      // Other people can't see the job.
      const sam = await signIn(b, 'mock-sam');
      expect((await request(b.base).get(`/api/recipes/jobs/${q.body.job.id}`).set('cookie', sam)).status).toBe(404);
      // Counted against the quota and visible in the admin log.
      const adminJobs = await request(b.base).get('/api/admin/jobs').set('cookie', ada);
      expect(adminJobs.body.jobs.map((j: { id: string }) => j.id)).toContain(q.body.job.id);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('retries transient vendor failures with backoff and gives up on permanent ones', async () => {
    const { createMockClient } = await import('./ai/mock.js');
    const { AiError } = await import('./ai/types.js');
    const real = createMockClient();
    let calls = 0;
    const flaky = {
      ...real,
      generate: async (input: Parameters<typeof real.generate>[0], cred: Parameters<typeof real.generate>[1]) => {
        calls++;
        if (input.prompt.includes('flaky') && calls < 3) throw new AiError('vendor_error', 'upstream hiccup', 502);
        if (input.prompt.includes('doomed')) throw new AiError('credential_rejected', 'key revoked', 401);
        return real.generate(input, cred);
      },
    };
    const b = await boot({}, { mock: flaky });
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      // Backoff would normally wait 5 s; pull the job forward each time it's requeued.
      const q = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'flaky ramen' });
      for (let i = 0; i < 40; i++) {
        const row = b.jobs.getRow(q.body.job.id)!;
        if (row.status === 'done' || row.status === 'failed') break;
        if (row.status === 'queued') {
          b.db.prepare(`UPDATE jobs SET run_after = ? WHERE id = ?`).run(new Date(0).toISOString(), row.id);
          await b.jobs.tick();
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      const done = await request(b.base).get(`/api/recipes/jobs/${q.body.job.id}`).set('cookie', ada);
      expect(done.body.job).toMatchObject({ status: 'done', attempts: 3 });
      expect(done.body.job.lastError).toBeNull();

      const d = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'doomed tacos' });
      await b.jobs.idle();
      const failed = await request(b.base).get(`/api/recipes/jobs/${d.body.job.id}`).set('cookie', ada);
      expect(failed.body.job).toMatchObject({ status: 'failed', attempts: 1, lastErrorCode: 'credential_rejected' });
      // The person can retry a failed job; cancelling a finished one is refused.
      expect((await request(b.base).post(`/api/recipes/jobs/${d.body.job.id}/cancel`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(400);
      expect((await request(b.base).post(`/api/recipes/jobs/${d.body.job.id}/retry`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      // Generation rows exist for every attempt (3 ok/failed for the flaky one + the doomed ones).
      const gens = await request(b.base).get('/api/admin/generations').set('cookie', ada);
      expect(gens.body.generations.length).toBeGreaterThanOrEqual(4);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('requeues jobs left running by a restart, and refuses more than three in flight', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      b.jobs.stop();
      b.db.prepare(`INSERT INTO jobs (id, kind, user_id, payload, status, attempts, max_attempts, created_at, run_after, started_at) VALUES ('job_stuck', 'generate', (SELECT id FROM users WHERE handle = 'ada_lovelace'), '{"prompt":"stuck"}', 'running', 1, 3, ?, ?, ?)`).run(
        new Date(Date.now() - 600_000).toISOString(),
        new Date(Date.now() - 600_000).toISOString(),
        new Date(Date.now() - 600_000).toISOString(),
      );
      b.jobs.recover();
      expect(b.jobs.getRow('job_stuck')!.status).toBe('queued');
      await b.jobs.tick();
      await b.jobs.idle();
      expect(b.jobs.getRow('job_stuck')!.status).toBe('done');

      // In-flight cap: queue three without running them, the fourth is refused, cancel frees a slot.
      const ids: string[] = [];
      for (let i = 0; i < 3; i++) {
        const q = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: `batch ${i}` });
        expect(q.status).toBe(202);
        ids.push(q.body.job.id);
        b.db.prepare(`UPDATE jobs SET status = 'queued', run_after = ? WHERE id = ?`).run(new Date(Date.now() + 3600_000).toISOString(), q.body.job.id);
      }
      expect((await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'one too many' })).status).toBe(429);
      expect((await request(b.base).post(`/api/recipes/jobs/${ids[0]}/cancel`).set('cookie', ada).set('origin', ORIGIN)).body.job.status).toBe('cancelled');
      expect((await request(b.base).get('/api/recipes/jobs?active=1').set('cookie', ada)).body.jobs).toHaveLength(2);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('recipe photos', () => {
  it('generates, checks and attaches a cover after a recipe is written; rejected photos retry once then give up', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      const me = await request(b.base).get('/api/auth/me').set('cookie', ada);
      expect(me.body).toMatchObject({ autoPhotos: true, aiCapabilities: { images: true, vision: true } });

      // Happy path: the generate job spawns an image job; the recipe ends up with a generated cover.
      const q = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'a bright lemon pasta' });
      await b.jobs.idle();
      await b.jobs.idle();
      const jobs = await request(b.base).get('/api/recipes/jobs').set('cookie', ada);
      const gen = jobs.body.jobs.find((j: { id: string }) => j.id === q.body.job.id);
      const img = jobs.body.jobs.find((j: { kind: string }) => j.kind === 'image');
      expect(gen.status).toBe('done');
      expect(img).toMatchObject({ status: 'done', recipeId: gen.recipeId });
      expect(img.prompt).toMatch(/^Photo for/);
      const recipe = await request(b.base).get(`/api/recipes/${gen.recipeId}`).set('cookie', ada);
      expect(recipe.body.recipe.media).toHaveLength(1);
      expect(recipe.body.recipe.media[0]).toMatchObject({ kind: 'image', mime: 'image/png', generated: true });
      expect((await request(b.base).get(`/api/media/${recipe.body.recipe.media[0].id}`).set('cookie', ada)).status).toBe(200);
      // Cost is visible: one image call and one vision call logged, with kinds.
      const gens = await request(b.base).get('/api/admin/generations').set('cookie', ada);
      expect(gens.body.generations.map((g: { kind: string }) => g.kind).sort()).toEqual(['image', 'recipe', 'vision']);

      // Rejection: the mock's vision says "no" for titles containing reject-me → retried once, then failed, emoji kept.
      const bad = await request(b.base).post('/api/recipes').set('cookie', ada).set('origin', ORIGIN).send({ emoji: '🥣', title: 'Soup reject-me', summary: 'x', mealType: 'dinner', servings: 2, totalMinutes: 20, activeMinutes: 10, difficulty: 'easy', cuisine: null, ingredients: [{ item: 'water', quantity: null, unit: null, preparation: null, note: null, group: null, optional: false, ingredientId: null }], steps: [{ title: 'Boil', text: 'Boil it.', timerSeconds: null, ingredientRefs: [], temperature: null, tip: null }] });
      const p = await request(b.base).post(`/api/recipes/${bad.body.recipe.id}/photo`).set('cookie', ada).set('origin', ORIGIN);
      expect(p.status).toBe(202);
      for (let i = 0; i < 40; i++) {
        const row = b.jobs.getRow(p.body.job.id)!;
        if (row.status === 'failed' || row.status === 'done') break;
        if (row.status === 'queued') {
          b.db.prepare(`UPDATE jobs SET run_after = ? WHERE id = ?`).run(new Date(0).toISOString(), row.id);
          await b.jobs.tick();
        }
        await new Promise((r) => setTimeout(r, 30));
      }
      const failed = b.jobs.get(p.body.job.id)!;
      expect(failed).toMatchObject({ status: 'failed', attempts: 2, lastErrorCode: 'image_rejected' });
      expect((await request(b.base).get(`/api/recipes/${bad.body.recipe.id}`).set('cookie', ada)).body.recipe.media).toHaveLength(0);
      // A second manual request while one is running is refused; the toggle turns auto photos off.
      await request(b.base).put('/api/auth/prefs').set('cookie', ada).set('origin', ORIGIN).send({ autoPhotos: false });
      const q2 = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'plain toast' });
      await b.jobs.idle();
      const after = await request(b.base).get('/api/recipes/jobs').set('cookie', ada);
      expect(after.body.jobs.filter((j: { kind: string; createdAt: string }) => j.kind === 'image' && j.createdAt > q2.body.job.createdAt)).toHaveLength(0);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('library photos', () => {
  /** A fake Commons with three photos of everything, served from the allowed host. */
  function fakeLibrary() {
    const shots = [1, 2, 3].map((n) => ({ provider: 'wikimedia' as const, url: `https://upload.wikimedia.org/shot${n}.png`, width: 1000, height: 800, credit: `Cook ${n}`, license: 'CC BY-SA 4.0', sourceUrl: `https://commons.wikimedia.org/wiki/File:Shot${n}.png` }));
    const source: PhotoSource = { id: 'wikimedia', search: async () => shots };
    const fetchImpl: typeof fetch = async (input) => {
      const n = Number(/shot(\d)/.exec(String(input))?.[1] ?? 1);
      return new Response(new Uint8Array(encodePng(16, 16, () => [60 * n, 100, 80])), { status: 200 });
    };
    return { shots, source, fetchImpl };
  }
  /** A vendor like Anthropic: writes recipes and looks at pictures, cannot make them. */
  function noImages() {
    const { generateImage: _drop, ...rest } = createMockClient();
    return { mock: rest };
  }

  it('finds a library photo for a recipe when the vendor cannot generate one, and shuffles through the rest', async () => {
    const lib = fakeLibrary();
    const b = await boot({}, noImages(), { photoSources: [lib.source], photoFetch: lib.fetchImpl });
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      expect((await request(b.base).get('/api/auth/me').set('cookie', ada)).body.aiCapabilities).toEqual({ images: false, vision: true });

      // Auto: generate → image job in source mode → cover with attribution; the vision check ran and was logged.
      const q = await request(b.base).post('/api/recipes/generate').set('cookie', ada).set('origin', ORIGIN).send({ prompt: 'shakshuka for two' });
      await b.jobs.idle();
      await b.jobs.idle();
      const gen = (await request(b.base).get('/api/recipes/jobs').set('cookie', ada)).body.jobs.find((j: { id: string }) => j.id === q.body.job.id);
      expect(gen.status).toBe('done');
      let recipe = (await request(b.base).get(`/api/recipes/${gen.recipeId}`).set('cookie', ada)).body.recipe;
      expect(recipe.media).toHaveLength(1);
      expect(recipe.media[0]).toMatchObject({ generated: true, source: 'wikimedia', credit: 'Cook 1', license: 'CC BY-SA 4.0', sourceUrl: lib.shots[0]!.sourceUrl, mime: 'image/png' });
      // Three candidates were looked at in one go; the other two grades are kept so no shuffle pays for them again.
      const gens = await request(b.base).get('/api/admin/generations').set('cookie', ada);
      expect(gens.body.generations.map((g: { kind: string }) => g.kind).sort()).toEqual(['recipe', 'vision', 'vision', 'vision']);
      // Generating with AI is refused for this vendor.
      expect((await request(b.base).post(`/api/recipes/${gen.recipeId}/photo`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(409);

      // Shuffle: each call brings the next unseen photo to the front; earlier ones stay behind it.
      const s1 = await request(b.base).post(`/api/recipes/${gen.recipeId}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      expect(s1.status).toBe(200);
      expect(s1.body.cover).toMatchObject({ credit: 'Cook 2' });
      expect(s1.body.media.map((m: { credit: string }) => m.credit)).toEqual(['Cook 2', 'Cook 1']);
      const s2 = await request(b.base).post(`/api/recipes/${gen.recipeId}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      expect(s2.body.media.map((m: { credit: string }) => m.credit)).toEqual(['Cook 3', 'Cook 2', 'Cook 1']);
      const dry = await request(b.base).post(`/api/recipes/${gen.recipeId}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      expect(dry.status).toBe(404);
      expect(dry.body.error.code).toBe('no_photo_found');
      expect((await request(b.base).get('/api/admin/generations').set('cookie', ada)).body.generations.filter((g: { kind: string }) => g.kind === 'vision')).toHaveLength(3);

      // Pick an earlier one as the cover; the summary cover follows.
      const first = s2.body.media[2];
      const pick = await request(b.base).post(`/api/recipes/${gen.recipeId}/media/${first.id}/cover`).set('cookie', ada).set('origin', ORIGIN);
      expect(pick.body.media[0].id).toBe(first.id);
      recipe = (await request(b.base).get(`/api/recipes/${gen.recipeId}`).set('cookie', ada)).body.recipe;
      expect(recipe.media[0].credit).toBe('Cook 1');
      const list = await request(b.base).get('/api/recipes').set('cookie', ada);
      expect(list.body.recipes.find((r: { id: string }) => r.id === gen.recipeId).cover.id).toBe(first.id);

      // Someone else can neither shuffle nor re-cover it.
      const sam = await signIn(b, 'mock-sam');
      await request(b.base).put('/api/profile').set('cookie', sam).set('origin', ORIGIN).send(PROFILE);
      expect((await request(b.base).post(`/api/recipes/${gen.recipeId}/photo/shuffle`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(404);
      expect((await request(b.base).post(`/api/recipes/${gen.recipeId}/media/${first.id}/cover`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(404);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('keeps searching past photos the check turns down, and remembers them', async () => {
    // Shots 1 and 2 are not food in the eyes of the mock vision model; shot 3 is fine.
    const shots = [1, 2, 3].map((n) => ({ provider: 'wikimedia' as const, url: `https://upload.wikimedia.org/shot${n}.png`, width: 1000, height: 800, credit: `Cook ${n}`, license: 'CC0', sourceUrl: `https://commons.wikimedia.org/wiki/File:Shot${n}.png` }));
    const source: PhotoSource = { id: 'wikimedia', search: async () => shots };
    const fetchImpl: typeof fetch = async () => new Response(new Uint8Array(encodePng(8, 8, () => [1, 2, 3])), { status: 200 });
    const base = createMockClient();
    const picky = { ...base, generateImage: undefined, describeImage: async (image: Buffer, recipe: { title: string; keyIngredients: string[] }, cred: never) => {
      // Reject the first two files by their bytes' identity: the fake serves the same PNG, so key off the call count.
      calls++;
      return base.describeImage!(image, { ...recipe, title: calls <= 2 ? 'not-food' : recipe.title }, cred);
    } };
    let calls = 0;
    const b = await boot({}, { mock: picky as never }, { photoSources: [source], photoFetch: fetchImpl });
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      const made = await request(b.base).post('/api/recipes').set('cookie', ada).set('origin', ORIGIN).send({ emoji: '🥣', title: 'Soup', summary: 'x', mealType: 'dinner', servings: 2, totalMinutes: 20, activeMinutes: 10, difficulty: 'easy', cuisine: null, ingredients: [{ item: 'water', quantity: null, unit: null, preparation: null, note: null, group: null, optional: false, ingredientId: null }], steps: [{ title: 'Boil', text: 'Boil it.', timerSeconds: null, ingredientRefs: [], temperature: null, tip: null }] });
      const s1 = await request(b.base).post(`/api/recipes/${made.body.recipe.id}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      expect(s1.status).toBe(200);
      expect(s1.body.cover.credit).toBe('Cook 3');
      expect(calls).toBe(3);
      // The two rejects are remembered: nothing left, and no more vision calls spent on them.
      const dry = await request(b.base).post(`/api/recipes/${made.body.recipe.id}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      expect(dry.status).toBe(404);
      expect(calls).toBe(3);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('lets an admin backfill the house kitchen, once', async () => {
    const lib = fakeLibrary();
    const b = await boot({ FOODI_HOUSE_KITCHEN: 'true' }, undefined, { photoSources: [lib.source], photoFetch: lib.fetchImpl });
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      const sam = await signIn(b, 'mock-sam');
      await request(b.base).put('/api/profile').set('cookie', sam).set('origin', ORIGIN).send(PROFILE);
      expect((await request(b.base).post('/api/admin/photos/backfill').set('cookie', sam).set('origin', ORIGIN)).status).toBe(403);

      const houseId = b.house.account().id;
      const total = (b.db.prepare('SELECT COUNT(*) AS n FROM recipes WHERE user_id = ?').get(houseId) as { n: number }).n;
      const first = await request(b.base).post('/api/admin/photos/backfill').set('cookie', ada).set('origin', ORIGIN);
      expect(first.body.queued).toBe(total);
      // Queued again while running → nothing new.
      expect((await request(b.base).post('/api/admin/photos/backfill').set('cookie', ada).set('origin', ORIGIN)).body.queued).toBe(0);
      await b.jobs.idle();
      const withPhoto = (b.db.prepare(`SELECT COUNT(DISTINCT recipe_id) AS n FROM media WHERE owner_id = ? AND source = 'wikimedia'`).get(houseId) as { n: number }).n;
      expect(withPhoto).toBe(total);
      // The house had no credential, so no vision calls were billed to anyone.
      expect((b.db.prepare(`SELECT COUNT(*) AS n FROM generations WHERE kind = 'vision'`).get() as { n: number }).n).toBe(0);
      // A fresh person sees the house post's recipe with its cover.
      const feed = await request(b.base).get('/api/social/feed').set('cookie', sam);
      const house = feed.body.items.find((i: { type: string; post?: { isHouse: boolean } }) => i.type === 'post' && i.post?.isHouse);
      expect(house.post.recipe.cover).toBeTruthy();
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('link previews', () => {
  it('describes public recipes, people, books and posts for unfurlers; private things get the site card', async () => {
    const lib = (() => {
      const shot = { provider: 'wikimedia' as const, url: 'https://upload.wikimedia.org/s.png', width: 1000, height: 800, credit: 'Cook', license: 'CC0', sourceUrl: 'https://commons.wikimedia.org/wiki/File:S.png' };
      return { source: { id: 'wikimedia', search: async () => [shot] } as PhotoSource, fetchImpl: (async () => new Response(new Uint8Array(encodePng(8, 8, () => [9, 9, 9])), { status: 200 })) as typeof fetch };
    })();
    const b = await boot({ FOODI_HOUSE_KITCHEN: 'true' }, undefined, { photoSources: [lib.source], photoFetch: lib.fetchImpl });
    try {
      const { tagsForPath, sitemapXml } = await import('./share.js');
      const origin = 'https://foodi.example';
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      const made = await request(b.base).post('/api/recipes').set('cookie', ada).set('origin', ORIGIN).send({ emoji: '🥣', title: 'Ada & the soup', summary: 'A soup for sharing.', mealType: 'dinner', servings: 2, totalMinutes: 20, activeMinutes: 10, difficulty: 'easy', cuisine: null, ingredients: [{ item: 'water', quantity: null, unit: null, preparation: null, note: null, group: null, optional: false, ingredientId: null }], steps: [{ title: 'Boil', text: 'Boil it.', timerSeconds: null, ingredientRefs: [], temperature: null, tip: null }] });
      const id = made.body.recipe.id;

      // Private: nothing to say, and the cover endpoint is closed.
      expect(tagsForPath(b.db, origin, `/app/recipes/${id}`)).toBeNull();
      expect(tagsForPath(b.db, origin, '/app/recipes/nope')).toBeNull();
      expect(tagsForPath(b.db, origin, '/app/settings')).toBeNull();

      // Shared with a library photo: title, summary, author and an anonymous cover URL.
      await request(b.base).post(`/api/recipes/${id}/photo/shuffle`).set('cookie', ada).set('origin', ORIGIN);
      await request(b.base).post(`/api/social/posts`).set('cookie', ada).set('origin', ORIGIN).send({ recipeId: id, caption: 'Soup night', mediaIds: [] });
      const tags = tagsForPath(b.db, origin, `/app/recipes/${id}`)!;
      expect(tags.title).toBe('🥣 Ada & the soup — foodi');
      expect(tags.description).toContain('A soup for sharing. (20 min · serves 2)');
      expect(tags.image).toBe(`${origin}/share/recipes/${id}/cover.png`);
      expect(tags.url).toBe(`${origin}/app/recipes/${id}`);
      const cover = await request(b.base).get(`/share/recipes/${id}/cover.png`);
      expect(cover.status).toBe(200);
      expect(cover.headers['content-type']).toBe('image/png');
      expect(cover.headers['cross-origin-resource-policy']).toBe('cross-origin');
      expect((await request(b.base).get('/share/recipes/nope/cover.png')).status).toBe(404);

      // People and the house kitchen's books; the featured list is public and only lists house recipes with photos.
      const me = await request(b.base).get('/api/auth/me').set('cookie', ada);
      expect(tagsForPath(b.db, origin, `/app/u/${me.body.handle}`)!.title).toContain('on foodi');
      const book = b.db.prepare(`SELECT id FROM recipe_books WHERE visibility = 'public' LIMIT 1`).get() as { id: string };
      expect(tagsForPath(b.db, origin, `/app/books/${book.id}`)!.title).toContain('recipe book on foodi');
      const featured = await request(b.base).get('/share/featured.json');
      expect(featured.status).toBe(200);
      expect(featured.body.total).toBeGreaterThan(50);
      expect(featured.body.recipes.every((r: { cover: string }) => r.cover.startsWith('/share/recipes/'))).toBe(true);
      expect(featured.body.recipes.some((r: { id: string }) => r.id === id)).toBe(false);

      // Sitemap and robots need no session.
      const xml = sitemapXml(b.db, origin);
      expect(xml).toContain(`<loc>${origin}/app/recipes/${id}</loc>`);
      expect((await request(b.base).get('/robots.txt')).text).toContain('Disallow: /api/');
      expect((await request(b.base).get('/sitemap.xml')).headers['content-type']).toContain('application/xml');
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('shopping list', () => {
  const soup = (title: string) => ({ emoji: '🥣', title, summary: 'x', mealType: 'dinner', servings: 2, totalMinutes: 20, activeMinutes: 10, difficulty: 'easy', cuisine: null, steps: [{ title: 'Boil', text: 'Boil it.', timerSeconds: null, ingredientRefs: [], temperature: null, tip: null }] });
  const ing = (item: string, quantity: string | null, unit: string | null, extra: Record<string, unknown> = {}) => ({ item, quantity, unit, preparation: null, note: null, group: null, optional: false, ingredientId: null, ...extra });

  it('fills from recipes with scaling and merging, takes quick-add lines, checks, clears, and is private', async () => {
    const b = await boot();
    try {
      const ada = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', ada).set('origin', ORIGIN).send(PROFILE);
      const empty = await request(b.base).get('/api/list').set('cookie', ada);
      expect(empty.body).toEqual({ items: [], counts: { open: 0, checked: 0 } });

      // A recipe for 2 added at 4 servings: numbers double, non-numeric quantities stay as words, garnishes are skipped.
      const made = await request(b.base).post('/api/recipes').set('cookie', ada).set('origin', ORIGIN).send({
        ...soup('Lemon soup'),
        ingredients: [ing('lemons', '2', null, { ingredientId: 'lemon' }), ing('olive oil', '1 1/2', 'tbsp'), ing('parsley', 'a handful', null), ing('chilli flakes', '1', 'tsp', { optional: true })],
      });
      const first = await request(b.base).post('/api/list/items').set('cookie', ada).set('origin', ORIGIN).send({ fromRecipe: { recipeId: made.body.recipe.id, servings: 4 } });
      expect(first.status).toBe(201);
      expect(first.body).toMatchObject({ added: 3, merged: 0 });
      const byText = Object.fromEntries(first.body.items.map((i: { text: string }) => [i.text, i]));
      expect(byText['lemons']).toMatchObject({ quantity: 4, unit: null, ingredientId: 'lemon', category: 'fruit', recipeTitle: 'Lemon soup' });
      expect(byText['olive oil']).toMatchObject({ quantity: 3, unit: 'tbsp', category: 'oils & condiments' });
      expect(byText['a handful parsley']).toMatchObject({ quantity: null, category: 'herbs & spices' });
      expect(byText['chilli flakes']).toBeUndefined();

      // Quick add merges into the same ingredient + unit; a different unit is its own line; unknown things go to "other".
      const q1 = await request(b.base).post('/api/list/items').set('cookie', ada).set('origin', ORIGIN).send({ text: '3 lemons' });
      expect(q1.body).toMatchObject({ added: 0, merged: 1 });
      expect(q1.body.items.find((i: { text: string }) => i.text === 'lemons').quantity).toBe(7);
      const q2 = await request(b.base).post('/api/list/items').set('cookie', ada).set('origin', ORIGIN).send({ text: '500 g lemons' });
      expect(q2.body).toMatchObject({ added: 1, merged: 0 });
      const q3 = await request(b.base).post('/api/list/items').set('cookie', ada).set('origin', ORIGIN).send({ text: 'birthday candles' });
      expect(q3.body.items.find((i: { text: string }) => i.text === 'birthday candles')).toMatchObject({ category: 'other', quantity: null });

      // Only the ticked ingredients when indexes are given (including an optional one).
      const some = await request(b.base).post('/api/list/items').set('cookie', ada).set('origin', ORIGIN).send({ fromRecipe: { recipeId: made.body.recipe.id, ingredientIndexes: [3] } });
      expect(some.body).toMatchObject({ added: 1 });
      expect(some.body.items.find((i: { text: string }) => i.text === 'chilli flakes')).toMatchObject({ quantity: 1, unit: 'tsp' });

      // Check one off, edit another, delete one.
      const lemons = q2.body.items.find((i: { text: string }) => i.text === 'lemons');
      const checked = await request(b.base).patch(`/api/list/items/${lemons.id}`).set('cookie', ada).set('origin', ORIGIN).send({ checked: true });
      expect(checked.body.item.checked).toBe(true);
      const oil = q2.body.items.find((i: { text: string }) => i.text === 'olive oil');
      const edited = await request(b.base).patch(`/api/list/items/${oil.id}`).set('cookie', ada).set('origin', ORIGIN).send({ text: 'sunflower oil', quantity: 2 });
      expect(edited.body.item).toMatchObject({ text: 'sunflower oil', quantity: 2, unit: 'tbsp' });
      expect((await request(b.base).delete(`/api/list/items/${q3.body.items.find((i: { text: string }) => i.text === 'birthday candles').id}`).set('cookie', ada).set('origin', ORIGIN)).status).toBe(200);
      const now = await request(b.base).get('/api/list').set('cookie', ada);
      expect(now.body.counts).toEqual({ open: 4, checked: 1 });

      // Someone else can't see or touch it.
      const sam = await signIn(b, 'mock-sam');
      await request(b.base).put('/api/profile').set('cookie', sam).set('origin', ORIGIN).send(PROFILE);
      expect((await request(b.base).get('/api/list').set('cookie', sam)).body.items).toEqual([]);
      expect((await request(b.base).patch(`/api/list/items/${oil.id}`).set('cookie', sam).set('origin', ORIGIN).send({ checked: true })).status).toBe(404);
      expect((await request(b.base).delete(`/api/list/items/${oil.id}`).set('cookie', sam).set('origin', ORIGIN)).status).toBe(404);
      // Nor add from Ada's private recipe.
      expect((await request(b.base).post('/api/list/items').set('cookie', sam).set('origin', ORIGIN).send({ fromRecipe: { recipeId: made.body.recipe.id } })).status).toBe(404);

      // Clear checked, then everything.
      const cleared = await request(b.base).post('/api/list/clear').set('cookie', ada).set('origin', ORIGIN).send({ checkedOnly: true });
      expect(cleared.body.removed).toBe(1);
      expect(cleared.body.items.every((i: { checked: boolean }) => !i.checked)).toBe(true);
      const all = await request(b.base).post('/api/list/clear').set('cookie', ada).set('origin', ORIGIN).send({ checkedOnly: false });
      expect(all.body.items).toEqual([]);
    } finally {
      b.server.close();
      b.close();
    }
  });
});

describe('managed OpenAI keys', () => {
  /** A fake OpenAI Administration API that remembers what it created. */
  function fakeAdmin() {
    const accounts = new Map<string, { project: string; name: string }>();
    let n = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const path = String(input).replace(/^https?:\/\/[^/]+/, '');
      const method = init?.method ?? 'GET';
      const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
      if (method === 'POST' && path === '/v1/organization/projects') return json(200, { id: 'proj_test', name: 'foodi people', status: 'active' });
      if (method === 'GET' && path.startsWith('/v1/organization/projects/')) return json(200, { id: 'proj_test', name: 'foodi people', status: 'active' });
      let m = /^\/v1\/organization\/projects\/([^/]+)\/service_accounts$/.exec(path);
      if (method === 'POST' && m) {
        const id = `svc_${++n}`;
        accounts.set(id, { project: m[1]!, name: (JSON.parse(init!.body as string) as { name: string }).name });
        return json(200, { id, name: 'x', api_key: { id: `key_${n}`, value: `sk-svc-${n}` } });
      }
      m = /^\/v1\/organization\/projects\/([^/]+)\/service_accounts\/([^/]+)$/.exec(path);
      if (method === 'DELETE' && m) {
        accounts.delete(m[2]!);
        return json(200, { id: m[2], deleted: true });
      }
      return json(404, { error: { message: 'no' } });
    };
    return { accounts, fetchImpl };
  }
  /** A person who signed up with a password: no AI attached, unlike the mock SSO personas. */
  async function register(b: Booted, email: string): Promise<string> {
    const reg = await request(b.base).post('/api/auth/register').set('origin', ORIGIN).send({ email, password: 'correct horse battery', displayName: 'Nell' });
    expect(reg.status).toBe(201);
    return reg.headers['set-cookie']![0]!.split(';')[0]!;
  }

  it('hands a new person a key after onboarding, caps their day, and retires it when they bring their own', async () => {
    const admin = fakeAdmin();
    // The 'openai' vendor is served by the mock client so generations don't touch the network.
    const b = await boot({ OPENAI_ADMIN_KEY: 'sk-admin-test' }, { openai: createMockClient() }, { openaiAdminFetch: admin.fetchImpl });
    try {
      const boss = await signIn(b, 'mock-ada');
      await request(b.base).put('/api/profile').set('cookie', boss).set('origin', ORIGIN).send(PROFILE);
      const nell = await register(b, 'nell@example.com');
      // Before onboarding: available, but nothing issued yet.
      let me = await request(b.base).get('/api/auth/me').set('cookie', nell);
      expect(me.body).toMatchObject({ vendor: null, managedAvailable: true, managed: null });
      expect(admin.accounts.size).toBe(0);

      // Finishing the profile queues the key; the job issues it.
      await request(b.base).put('/api/profile').set('cookie', nell).set('origin', ORIGIN).send(PROFILE);
      await b.jobs.idle();
      me = await request(b.base).get('/api/auth/me').set('cookie', nell);
      expect(me.body).toMatchObject({ vendor: 'openai', credentialKind: 'managed', credentialHint: 'vc-1', managedAvailable: false, managed: { limitPerDay: 10, usedToday: 0, images: false } });
      expect(admin.accounts.size).toBe(1);
      expect([...admin.accounts.values()][0]!.name).toContain('@');
      expect(me.body.aiCapabilities).toEqual({ images: false, vision: true }); // photos on foodi's dime are off by default
      // The project id was remembered.
      expect((await request(b.base).get('/api/admin/settings').set('cookie', boss)).body.server.managedKeys).toEqual({ configured: true, projectId: 'proj_test' });

      // It writes recipes, and the managed allowance is the binding cap.
      await request(b.base).put('/api/admin/settings').set('cookie', boss).set('origin', ORIGIN).send({ managedGenerationsPerUserPerDay: 1 });
      const g1 = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', nell).set('origin', ORIGIN).send({ prompt: 'soup' });
      expect(g1.status).toBe(201);
      const g2 = await request(b.base).post('/api/recipes/generate?sync=1').set('cookie', nell).set('origin', ORIGIN).send({ prompt: 'more soup' });
      expect(g2.status).toBe(429);
      expect(g2.body.error.message).toContain("foodi's AI");
      expect((await request(b.base).get('/api/auth/me').set('cookie', nell)).body.managed.usedToday).toBe(1);

      // Bringing your own key (verified against a stubbed OpenAI) deletes foodi's service account.
      const realFetch = globalThis.fetch;
      const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => (String(input).includes('/v1/models') ? new Response('{"data":[]}', { status: 200 }) : realFetch(input, init)));
      let own;
      try {
        own = await request(b.base).post('/api/auth/key').set('cookie', nell).set('origin', ORIGIN).send({ vendor: 'openai', apiKey: 'sk-own-0123456789abcdef0123456789' });
      } finally {
        spy.mockRestore();
      }
      expect(own.status).toBe(200);
      expect(own.body).toMatchObject({ vendor: 'openai', credentialKind: 'api_key', credentialHint: '6789', managed: null, managedAvailable: false });
      expect(admin.accounts.size).toBe(0);
      // Removing it makes foodi's available again, on request; removing foodi's retires it too.
      await request(b.base).delete('/api/auth/key').set('cookie', nell).set('origin', ORIGIN);
      const again = await request(b.base).post('/api/auth/managed').set('cookie', nell).set('origin', ORIGIN);
      expect(again.status).toBe(200);
      expect(again.body).toMatchObject({ credentialKind: 'managed', credentialHint: 'vc-2' });
      expect(admin.accounts.size).toBe(1);
      await request(b.base).delete('/api/auth/key').set('cookie', nell).set('origin', ORIGIN);
      expect(admin.accounts.size).toBe(0);

      // Admin can switch the feature off: new people get nothing, and the button says so.
      await request(b.base).put('/api/admin/settings').set('cookie', boss).set('origin', ORIGIN).send({ openaiManagedKeys: false });
      const otto = await register(b, 'otto@example.com');
      await request(b.base).put('/api/profile').set('cookie', otto).set('origin', ORIGIN).send(PROFILE);
      await b.jobs.idle();
      expect((await request(b.base).get('/api/auth/me').set('cookie', otto)).body).toMatchObject({ vendor: null, managedAvailable: false });
      expect((await request(b.base).post('/api/auth/managed').set('cookie', otto).set('origin', ORIGIN)).status).toBe(409);
    } finally {
      b.server.close();
      b.close();
    }
  });

  it('is simply absent without an admin key', async () => {
    const b = await boot();
    try {
      const boss = await signIn(b, 'mock-ada');
      const nell = await register(b, 'nell@example.com');
      await request(b.base).put('/api/profile').set('cookie', nell).set('origin', ORIGIN).send(PROFILE);
      await b.jobs.idle();
      expect((await request(b.base).get('/api/auth/me').set('cookie', nell)).body).toMatchObject({ vendor: null, managedAvailable: false, managed: null });
      expect((await request(b.base).post('/api/auth/managed').set('cookie', nell).set('origin', ORIGIN)).status).toBe(409);
      expect((await request(b.base).get('/api/admin/settings').set('cookie', boss)).body.server.managedKeys).toEqual({ configured: false, projectId: null });
    } finally {
      b.server.close();
      b.close();
    }
  });
});
