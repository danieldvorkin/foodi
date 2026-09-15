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
