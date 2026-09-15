import { Router, type Request } from 'express';
import { ConnectKeyRequestSchema, type AuthProviderInfo, type Me } from '@foodi/shared';
import type { Config } from '../config.js';
import { badRequest, forbidden, HttpError, notFound } from '../lib/errors.js';
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
      vendor: cred?.vendor ?? 'mock',
      credentialKind: cred?.kind ?? 'api_key',
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

  // ---- API key connect ------------------------------------------------------------------
  r.post('/key', async (req, res, next) => {
    try {
      const body = parse(ConnectKeyRequestSchema, req.body);
      const p = providers.find((x) => x.kind === 'api_key' && x.vendor === body.vendor);
      if (!p || p.kind !== 'api_key') throw notFound('That vendor is not available.');
      const verified = await p.verify(body.apiKey);
      if (!verified.ok) throw badRequest(verified.reason);

      const credential = { kind: 'api_key' as const, apiKey: body.apiKey };
      if (req.user) {
        // Already signed in: attach/replace the credential on this account.
        store.setCredential(req.user.id, p.vendor, credential);
        audit.record(req.user.id, 'credential.connect', 'user', req.user.id, { vendor: p.vendor });
        res.json(toMe(req.user.id));
        return;
      }
      if (!settings.get().allowSignups && !store.findUserByIdentity(verified.identity)) {
        throw forbidden('New sign-ups are paused right now.');
      }
      const user = store.signIn(verified.identity, credential, p.vendor);
      if (user.disabled_at) throw forbidden('This account has been disabled.');
      const session = finishSignIn(req, user.id);
      setSessionCookie(res, session.token, session.expiresAt, cookieOpts);
      log.info({ userId: user.id, provider: p.id }, 'signed in with key');
      res.json(toMe(user.id));
    } catch (e) {
      next(e);
    }
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
