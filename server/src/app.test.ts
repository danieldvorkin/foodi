import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { createApp } from './app.js';
import { loadConfig } from './config.js';
import { createLogger } from './lib/logger.js';
import { decrypt, encrypt, pkcePair } from './lib/crypto.js';

const ORIGIN = 'http://localhost:5100';

async function boot() {
  const config = loadConfig({ ...process.env, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: 'http://127.0.0.1:0' });
  const log = createLogger('silent', false);
  const built = await createApp({ config, log });
  // The mock IdP needs a reachable issuer; bind an ephemeral port and rewrite the origin.
  const server = built.app.listen(0);
  const port = (server.address() as { port: number }).port;
  server.close();
  built.close();
  const cfg2 = loadConfig({ ...process.env, FOODI_APP_ORIGIN: ORIGIN, FOODI_API_ORIGIN: `http://127.0.0.1:${port}` });
  const built2 = await createApp({ config: cfg2, log });
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
    expect(() => decrypt(`${v}.${iv}.${body}.${tag!.slice(0, -2)}AA`, key)).toThrow();
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
    expect(audit.body.entries.map((e: { action: string }) => e.action)).toEqual(['user.disable', 'user.role']);
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
      .post('/api/recipes/generate')
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
    const res = await request(b.base).post('/api/recipes/generate').set('cookie', fresh).set('origin', ORIGIN).send({ prompt: 'anything' });
    expect(res.status).toBe(400);
  });

  it('keeps private recipes private, and sharing makes them readable', async () => {
    const gen = await request(b.base).post('/api/recipes/generate').set('cookie', session).set('origin', ORIGIN).send({ prompt: 'soup' });
    const id = gen.body.recipe.id;
    const other = await signIn(b, 'mock-sam');
    expect((await request(b.base).get(`/api/recipes/${id}`).set('cookie', other)).status).toBe(403);
    const post = await request(b.base).post('/api/social/posts').set('cookie', session).set('origin', ORIGIN).send({ recipeId: id, caption: 'Made this tonight' });
    expect(post.status).toBe(201);
    expect((await request(b.base).get(`/api/recipes/${id}`).set('cookie', other)).status).toBe(200);
    const feed = await request(b.base).get('/api/social/feed').set('cookie', other);
    expect(feed.body.posts).toHaveLength(1);
    expect(feed.body.posts[0].author.handle).toBe('ada_lovelace');
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
    const gen = await request(b.base).post('/api/recipes/generate').set('cookie', session).set('origin', ORIGIN).send({ prompt: 'soup' });
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
      const gen = await request(b.base).post('/api/recipes/generate').set('cookie', author).set('origin', ORIGIN).send({ prompt: 'anything' });
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
      const gen = await request(b.base).post('/api/recipes/generate').set('cookie', author).set('origin', ORIGIN).send({ prompt: 'anything' });
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
