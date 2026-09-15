import { Router, type Request } from 'express';
import { ChangePasswordSchema, ConnectKeyRequestSchema, LoginSchema, RegisterSchema, type AuthProviderInfo, type Me } from '@foodi/shared';
import { hashPassword, needsRehash, passwordProblem, verifyPassword } from '../lib/password.js';
import type { Config } from '../config.js';
import { badRequest, conflict, forbidden, HttpError, notFound, unauthorized } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';
import { randomToken, safeEqual } from '../lib/crypto.js';
import { requireAuth } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import type { Settings } from '../services/settings.js';
import type { Audit } from '../services/audit.js';
import { clearOAuthCookie, clearSessionCookie, readOAuthCookie, setOAuthCookie, setSessionCookie } from './cookies.js';
import type { AuthProvider, OAuthProvider } from './providers/types.js';
import type { AuthStore } from './store.js';

interface Deps {
  config: Config;
  log: Logger;
  store: AuthStore;
  providers: AuthProvider[];
  settings: Settings;
  audit: Audit;
}

/** A real scrypt hash of a random string, so failed logins for unknown emails take as long as known ones. */
const DUMMY_HASH = 'scrypt$131072$8$1$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA';

export function authRoutes({ config, log, store, providers, settings, audit }: Deps) {
  const r = Router();
  const cookieOpts = { secure: config.cookieSecure };
  const byId = new Map(providers.map((p) => [p.id, p]));
  const redirectUriFor = (p: OAuthProvider) => `${config.apiOrigin}/api/auth/${p.id}/callback`;

  /** Only ever send the browser to a path on our own app. */
  function safeReturnTo(input: unknown): string {
    if (typeof input !== 'string') return '/app';
    if (!input.startsWith('/') || input.startsWith('//') || input.includes('\\')) return '/app';
    return input.slice(0, 200);
  }

  function toMe(userId: string): Me {
    const user = store.getUser(userId);
    if (!user) throw notFound();
    const cred = store.getCredentialMeta(user.id);
    return {
      id: user.id,
      role: user.role,
      displayName: user.display_name,
      email: user.email,
      avatar: user.avatar_emoji,
      handle: user.handle,
      signInMethods: store.listIdentities(user.id).map((i) => i.provider),
      vendor: cred?.vendor ?? null,
      credentialKind: cred?.kind ?? null,
      hasProfile: store.hasProfile(user.id),
      createdAt: user.created_at,
    };
  }

  function finishSignIn(req: Request, userId: string) {
    return store.createSession(userId, { ip: req.ip ?? null, userAgent: req.headers['user-agent'] ?? null });
  }

  r.get('/providers', (_req, res) => {
    const list: AuthProviderInfo[] = providers.map((p) => ({ id: p.id, vendor: p.vendor, label: p.label, kind: p.kind, note: p.note }));
    res.json({ providers: list, allowSignups: settings.get().allowSignups, maintenanceMessage: settings.get().maintenanceMessage });
  });

  r.get('/me', (req, res) => {
    if (!req.user) {
      res.status(401).json({ error: { code: 'unauthorized', message: 'Not signed in.' } });
      return;
    }
    res.json(toMe(req.user.id));
  });

  // ---- OAuth: start ---------------------------------------------------------------------
  r.get('/:provider/start', async (req, res, next) => {
    try {
      const p = byId.get(req.params['provider'] ?? '');
      if (!p || p.kind !== 'oauth') throw notFound('Unknown sign-in provider.');
      const state = randomToken(24);
      const { url, transaction } = await p.start({ state, redirectUri: redirectUriFor(p) });
      setOAuthCookie(res, { ...transaction, state, provider: p.id, returnTo: safeReturnTo(req.query['returnTo']) }, config.encryptionKey, cookieOpts);
      res.redirect(302, url);
    } catch (e) {
      next(e);
    }
  });

  // ---- OAuth: callback ------------------------------------------------------------------
  r.get('/:provider/callback', async (req, res, next) => {
    const fail = (msg: string) => res.redirect(302, `${config.appOrigin}/?error=${encodeURIComponent(msg)}`);
    try {
      const p = byId.get(req.params['provider'] ?? '');
      if (!p || p.kind !== 'oauth') throw notFound('Unknown sign-in provider.');
      const tx = readOAuthCookie(req, config.encryptionKey);
      clearOAuthCookie(res, cookieOpts);
      if (!tx || tx['provider'] !== p.id) return fail('Your sign-in expired. Start again.');

      const q = req.query as Record<string, string | undefined>;
      if (q['error']) return fail(q['error_description'] ?? `Sign-in was cancelled (${q['error']}).`);
      if (!q['code'] || !q['state'] || !safeEqual(q['state'], tx['state'] ?? '')) return fail('Sign-in response did not match this browser. Start again.');

      const { identity, credential } = await p.callback({ code: q['code'], redirectUri: redirectUriFor(p), transaction: tx });

      // Already signed in (e.g. with a password): link this provider to the current account.
      if (req.user) {
        const linked = store.linkIdentity(req.user.id, identity, credential, p.vendor);
        if (!linked.ok) return res.redirect(302, `${config.appOrigin}/app/settings?error=${encodeURIComponent('That account is already linked to someone else.')}`);
        audit.record(req.user.id, 'identity.link', 'user', req.user.id, { provider: p.id });
        return res.redirect(302, `${config.appOrigin}${safeReturnTo(tx['returnTo'])}`);
      }

      // Signups can be paused by an admin; existing accounts still sign in.
      if (!settings.get().allowSignups && !store.findUserByIdentity(identity)) {
        return fail('New sign-ups are paused right now.');
      }

      const user = store.signIn(identity, credential, p.vendor);
      if (user.disabled_at) return fail('This account has been disabled.');
      const session = finishSignIn(req, user.id);
      setSessionCookie(res, session.token, session.expiresAt, cookieOpts);
      log.info({ userId: user.id, provider: p.id }, 'signed in');
      res.redirect(302, `${config.appOrigin}${store.hasProfile(user.id) ? safeReturnTo(tx['returnTo']) : '/onboarding'}`);
    } catch (e) {
      if (e instanceof HttpError && e.status < 500) return fail(e.message);
      next(e);
    }
  });

  // ---- email + password -------------------------------------------------------------------
  r.post('/register', async (req, res, next) => {
    try {
      const body = parse(RegisterSchema, req.body);
      if (!settings.get().allowSignups) throw forbidden('New sign-ups are paused right now.');
      const problem = passwordProblem(body.password, body.email);
      if (problem) throw badRequest(problem, [{ path: 'password', message: problem }]);
      const user = store.register({ email: body.email, displayName: body.displayName, passwordHash: await hashPassword(body.password) });
      if (!user) throw conflict('An account with that email already exists. Sign in instead.');
      const session = finishSignIn(req, user.id);
      setSessionCookie(res, session.token, session.expiresAt, cookieOpts);
      log.info({ userId: user.id }, 'registered');
      res.status(201).json(toMe(user.id));
    } catch (e) {
      next(e);
    }
  });

  r.post('/login', async (req, res, next) => {
    try {
      const body = parse(LoginSchema, req.body);
      const user = store.findPasswordUser(body.email);
      // Same message and similar timing whether the email exists or not.
      const ok = user ? await verifyPassword(body.password, user.hash) : await verifyPassword(body.password, DUMMY_HASH).then(() => false);
      if (!user || !ok) throw unauthorized('Email or password is incorrect.');
      if (user.disabled_at) throw forbidden('This account has been disabled.');
      if (needsRehash(user.hash)) store.setPasswordHash(user.id, await hashPassword(body.password));
      store.touch(user.id);
      const session = finishSignIn(req, user.id);
      setSessionCookie(res, session.token, session.expiresAt, cookieOpts);
      log.info({ userId: user.id }, 'signed in with password');
      res.json(toMe(user.id));
    } catch (e) {
      next(e);
    }
  });

  r.post('/password', requireAuth, async (req, res, next) => {
    try {
      const body = parse(ChangePasswordSchema, req.body);
      const user = req.user!;
      const current = store.getPasswordHash(user.id);
      const problem = passwordProblem(body.next, body.email ?? user.email ?? '');
      if (problem) throw badRequest(problem, [{ path: 'next', message: problem }]);
      if (current) {
        if (!body.current || !(await verifyPassword(body.current, current))) throw unauthorized('Current password is incorrect.');
        store.setPasswordHash(user.id, await hashPassword(body.next));
      } else {
        // SSO-only account adding a password: it needs an email to sign in with.
        const email = body.email ?? user.email;
        if (!email) throw badRequest('Add an email address to sign in with.', [{ path: 'email', message: 'Required' }]);
        const added = store.addPasswordLogin(user.id, email, await hashPassword(body.next));
        if (!added.ok) throw conflict('That email already has an account.');
      }
      // Other sessions are signed out; this one gets a fresh cookie.
      store.destroyAllSessions(user.id);
      const session = finishSignIn(req, user.id);
      setSessionCookie(res, session.token, session.expiresAt, cookieOpts);
      audit.record(user.id, 'password.change', 'user', user.id);
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- AI credential: connect an API key to the signed-in account ------------------------
  r.post('/key', requireAuth, async (req, res, next) => {
    try {
      const body = parse(ConnectKeyRequestSchema, req.body);
      const p = providers.find((x) => x.kind === 'api_key' && x.vendor === body.vendor);
      if (!p || p.kind !== 'api_key') throw notFound('That vendor is not available.');
      const verified = await p.verify(body.apiKey);
      if (!verified.ok) throw badRequest(verified.reason);
      store.setCredential(req.user!.id, p.vendor, { kind: 'api_key', apiKey: body.apiKey });
      audit.record(req.user!.id, 'credential.connect', 'user', req.user!.id, { vendor: p.vendor });
      res.json(toMe(req.user!.id));
    } catch (e) {
      next(e);
    }
  });

  r.delete('/key', requireAuth, (req, res) => {
    store.clearCredential(req.user!.id);
    audit.record(req.user!.id, 'credential.disconnect', 'user', req.user!.id);
    res.json(toMe(req.user!.id));
  });

  r.post('/logout', requireAuth, async (req, res) => {
    if (req.sessionToken) store.destroySession(req.sessionToken);
    clearSessionCookie(res, cookieOpts);
    res.json({ ok: true });
  });

  r.post('/logout-everywhere', requireAuth, (req, res) => {
    store.destroyAllSessions(req.user!.id);
    clearSessionCookie(res, cookieOpts);
    res.json({ ok: true });
  });

  /** Delete account and every trace: identities, credential, sessions, recipes, posts. */
  r.delete('/account', requireAuth, async (req, res) => {
    const user = req.user!;
    const cred = store.getCredential(user.id);
    const p = providers.find((x) => x.vendor === cred?.vendor && x.kind === 'oauth') as OAuthProvider | undefined;
    if (cred && p?.revoke) await p.revoke(cred.payload).catch(() => {});
    store.deleteUser(user.id);
    clearSessionCookie(res, cookieOpts);
    log.info({ userId: user.id }, 'account deleted');
    res.json({ ok: true });
  });

  return r;
}
