import { Router } from 'express';

import {
  AdminUpdateUserSchema,
  AppSettingsSchema,
  type AdminStats,
  type AdminUser,
  type AuditEntry,
  type GenerationLog,
  type RecipeContent,
} from '@foodi/shared';
import type { AuthStore } from '../auth/store.js';
import type { Config } from '../config.js';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { badRequest, notFound } from '../lib/errors.js';
import { now } from '../lib/time.js';
import { requireRole } from '../middleware/auth.js';
import { parse } from '../middleware/validate.js';
import type { Audit } from '../services/audit.js';
import type { Settings } from '../services/settings.js';
import type { MediaStore } from './media.js';
import { unshareIfOrphan } from './social.js';

interface Deps {
  db: Db;
  config: Config;
  store: AuthStore;
  settings: Settings;
  audit: Audit;
  providerIds: string[];
  mediaStore: MediaStore;
}

export function adminRoutes({ db, config, store, settings, audit, providerIds, mediaStore }: Deps) {
  const r = Router();
  r.use(requireRole('admin'));

  // ---- overview ---------------------------------------------------------------------------
  r.get('/stats', (_req, res) => {
    const since7 = new Date(Date.now() - 7 * 86400_000).toISOString();
    const count = (sql: string, ...p: unknown[]) => one<{ n: number }>(db, sql, ...p)!.n;
    const latencies = all<{ latency_ms: number }>(db, `SELECT latency_ms FROM generations WHERE created_at > ? AND status = 'ok' ORDER BY latency_ms`, since7);
    const median = latencies.length ? latencies[Math.floor(latencies.length / 2)]!.latency_ms : null;
    const byDayRows = all<{ day: string; ok: number; failed: number }>(
      db,
      `SELECT substr(created_at, 1, 10) AS day, SUM(status = 'ok') AS ok, SUM(status = 'failed') AS failed FROM generations WHERE created_at > ? GROUP BY day`,
      new Date(Date.now() - 14 * 86400_000).toISOString(),
    );
    const byDayMap = new Map(byDayRows.map((x) => [x.day, x]));
    const generationsByDay: AdminStats['generationsByDay'] = [];
    for (let i = 13; i >= 0; i--) {
      const day = new Date(Date.now() - i * 86400_000).toISOString().slice(0, 10);
      const x = byDayMap.get(day);
      generationsByDay.push({ day, ok: x?.ok ?? 0, failed: x?.failed ?? 0 });
    }
    const stats: AdminStats = {
      users: count('SELECT COUNT(*) AS n FROM users'),
      admins: count(`SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`),
      disabledUsers: count('SELECT COUNT(*) AS n FROM users WHERE disabled_at IS NOT NULL'),
      recipes: count('SELECT COUNT(*) AS n FROM recipes'),
      mediaCount: count('SELECT COUNT(*) AS n FROM media'),
      mediaBytes: one<{ n: number }>(db, 'SELECT COALESCE(SUM(bytes), 0) AS n FROM media')!.n,
      generations7d: count(`SELECT COUNT(*) AS n FROM generations WHERE created_at > ?`, since7),
      failures7d: count(`SELECT COUNT(*) AS n FROM generations WHERE created_at > ? AND status = 'failed'`, since7),
      medianLatencyMs7d: median,
      generationsByDay,
      byVendor: all<{ vendor: string; count: number }>(db, 'SELECT vendor, COUNT(*) AS count FROM credentials GROUP BY vendor ORDER BY count DESC'),
    };
    res.json(stats);
  });

  // ---- users ------------------------------------------------------------------------------
  const USER_SELECT = `
    SELECT u.id, u.role, u.display_name, u.email, u.handle, u.disabled_at, u.created_at, u.last_seen_at,
           c.vendor, c.kind,
           (SELECT COUNT(*) FROM recipes r WHERE r.user_id = u.id) AS recipe_count,
           (SELECT COUNT(*) FROM generations g WHERE g.user_id = u.id) AS generation_count,
           (SELECT COUNT(*) FROM sessions s WHERE s.user_id = u.id AND s.expires_at > ?) AS active_sessions
    FROM users u LEFT JOIN credentials c ON c.user_id = u.id`;
  interface UserRowX {
    id: string; role: 'admin' | 'consumer'; display_name: string | null; email: string | null; handle: string; disabled_at: string | null;
    created_at: string; last_seen_at: string | null; vendor: string | null; kind: 'oauth' | 'api_key' | null; recipe_count: number; generation_count: number; active_sessions: number;
  }
  const toAdminUser = (u: UserRowX): AdminUser & { handle: string } => ({
    id: u.id,
    role: u.role,
    displayName: u.display_name,
    email: u.email,
    handle: u.handle,
    vendor: (u.vendor as AdminUser['vendor'] | null) ?? null,
    credentialKind: u.kind ?? null,
    disabledAt: u.disabled_at,
    createdAt: u.created_at,
    lastSeenAt: u.last_seen_at,
    recipeCount: u.recipe_count,
    generationCount: u.generation_count,
    activeSessions: u.active_sessions,
  });

  r.get('/users', (req, res) => {
    const q = typeof req.query['q'] === 'string' ? `%${req.query['q'].trim()}%` : null;
    const rows = q
      ? all<UserRowX>(db, `${USER_SELECT} WHERE u.display_name LIKE ? OR u.email LIKE ? OR u.handle LIKE ? OR u.id LIKE ? ORDER BY u.created_at DESC LIMIT 200`, now(), q, q, q, q)
      : all<UserRowX>(db, `${USER_SELECT} ORDER BY u.created_at DESC LIMIT 200`, now());
    res.json({ users: rows.map(toAdminUser) });
  });

  r.get('/users/:id', (req, res) => {
    const u = one<UserRowX>(db, `${USER_SELECT} WHERE u.id = ?`, now(), req.params['id']);
    if (!u) throw notFound('No such user.');
    const identities = store.listIdentities(u.id);
    const recipes = all<{ id: string; title: string; source: string; visibility: string; created_at: string }>(db, 'SELECT id, title, source, visibility, created_at FROM recipes WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', u.id);
    const generations = all<GenRow>(db, `${GEN_SELECT} WHERE g.user_id = ? ORDER BY g.created_at DESC LIMIT 50`, u.id).map(toGen);
    res.json({ user: toAdminUser(u), identities, recipes, generations });
  });

  r.patch('/users/:id', (req, res) => {
    const actor = req.user!;
    const target = store.getUser(req.params['id']!);
    if (!target) throw notFound('No such user.');
    const body = parse(AdminUpdateUserSchema, req.body);
    if (target.id === actor.id && (body.role === 'consumer' || body.disabled)) throw badRequest("You can't demote or disable yourself.");
    if (body.role && body.role !== target.role) {
      if (target.role === 'admin' && one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM users WHERE role = 'admin'`)!.n <= 1) {
        throw badRequest('There must be at least one admin.');
      }
      run(db, 'UPDATE users SET role = ? WHERE id = ?', body.role, target.id);
      audit.record(actor.id, 'user.role', 'user', target.id, { from: target.role, to: body.role });
    }
    if (body.disabled !== undefined && Boolean(target.disabled_at) !== body.disabled) {
      run(db, 'UPDATE users SET disabled_at = ? WHERE id = ?', body.disabled ? now() : null, target.id);
      if (body.disabled) store.destroyAllSessions(target.id);
      audit.record(actor.id, body.disabled ? 'user.disable' : 'user.enable', 'user', target.id);
    }
    const u = one<UserRowX>(db, `${USER_SELECT} WHERE u.id = ?`, now(), target.id)!;
    res.json({ user: toAdminUser(u) });
  });

  r.post('/users/:id/revoke-sessions', (req, res) => {
    const target = store.getUser(req.params['id']!);
    if (!target) throw notFound('No such user.');
    store.destroyAllSessions(target.id);
    audit.record(req.user!.id, 'user.revoke_sessions', 'user', target.id);
    res.json({ ok: true });
  });

  r.delete('/users/:id', (req, res) => {
    const actor = req.user!;
    const target = store.getUser(req.params['id']!);
    if (!target) throw notFound('No such user.');
    if (target.id === actor.id) throw badRequest("Delete your own account from Settings, not here.");
    store.deleteUser(target.id);
    audit.record(actor.id, 'user.delete', 'user', target.id, { handle: target.handle });
    res.json({ ok: true });
  });

  // ---- recipes & posts (moderation) -------------------------------------------------------
  r.get('/recipes', (req, res) => {
    const q = typeof req.query['q'] === 'string' ? `%${req.query['q'].trim()}%` : null;
    const rows = all<{ id: string; title: string; source: string; visibility: string; provider: string; created_at: string; user_id: string; handle: string; content: string }>(
      db,
      `SELECT r.id, r.title, r.source, r.visibility, r.provider, r.created_at, r.user_id, u.handle, r.content FROM recipes r JOIN users u ON u.id = r.user_id ${q ? 'WHERE r.title LIKE ? OR u.handle LIKE ?' : ''} ORDER BY r.created_at DESC LIMIT 200`,
      ...(q ? [q, q] : []),
    );
    res.json({
      recipes: rows.map((x) => {
        const c = JSON.parse(x.content) as RecipeContent;
        return { id: x.id, title: x.title, source: x.source, visibility: x.visibility, provider: x.provider, createdAt: x.created_at, userId: x.user_id, handle: x.handle, totalMinutes: c.totalMinutes, ingredientCount: c.ingredients.length, allergens: c.allergens };
      }),
    });
  });

  r.delete('/recipes/:id', (req, res) => {
    const row = one<{ id: string; user_id: string; title: string }>(db, 'SELECT id, user_id, title FROM recipes WHERE id = ?', req.params['id']);
    if (!row) throw notFound('No such recipe.');
    run(db, 'DELETE FROM recipes WHERE id = ?', row.id);
    audit.record(req.user!.id, 'recipe.delete', 'recipe', row.id, { owner: row.user_id, title: row.title });
    res.json({ ok: true });
  });

  r.get('/posts', (_req, res) => {
    const rows = all<{ id: string; caption: string; created_at: string; author_id: string; handle: string; title: string; likes: number; comments: number }>(
      db,
      `SELECT p.id, p.caption, p.created_at, p.author_id, u.handle, r.title,
              (SELECT COUNT(*) FROM likes l WHERE l.post_id = p.id) AS likes,
              (SELECT COUNT(*) FROM comments c WHERE c.post_id = p.id) AS comments
       FROM posts p JOIN users u ON u.id = p.author_id JOIN recipes r ON r.id = p.recipe_id ORDER BY p.created_at DESC LIMIT 200`,
    );
    res.json({ posts: rows.map((x) => ({ id: x.id, caption: x.caption, createdAt: x.created_at, authorId: x.author_id, handle: x.handle, recipeTitle: x.title, likeCount: x.likes, commentCount: x.comments })) });
  });

  r.delete('/posts/:id', (req, res) => {
    const row = one<{ id: string; author_id: string; recipe_id: string }>(db, 'SELECT id, author_id, recipe_id FROM posts WHERE id = ?', req.params['id']);
    if (!row) throw notFound('No such post.');
    tx(db, () => {
      run(db, 'DELETE FROM posts WHERE id = ?', row.id);
      unshareIfOrphan(db, row.recipe_id);
    });
    audit.record(req.user!.id, 'post.delete', 'post', row.id, { author: row.author_id });
    res.json({ ok: true });
  });

  r.get('/comments', (_req, res) => {
    const rows = all<{ id: string; body: string; created_at: string; author_id: string; handle: string; post_id: string }>(
      db,
      `SELECT c.id, c.body, c.created_at, c.author_id, u.handle, c.post_id FROM comments c JOIN users u ON u.id = c.author_id ORDER BY c.created_at DESC LIMIT 200`,
    );
    res.json({ comments: rows.map((x) => ({ id: x.id, body: x.body, createdAt: x.created_at, authorId: x.author_id, handle: x.handle, postId: x.post_id })) });
  });

  r.delete('/comments/:id', (req, res) => {
    const row = one<{ id: string; author_id: string }>(db, 'SELECT id, author_id FROM comments WHERE id = ?', req.params['id']);
    if (!row) throw notFound('No such comment.');
    run(db, 'DELETE FROM comments WHERE id = ?', row.id);
    audit.record(req.user!.id, 'comment.delete', 'comment', row.id, { author: row.author_id });
    res.json({ ok: true });
  });

  // ---- media (moderation) -----------------------------------------------------------------
  r.get('/media', (_req, res) => {
    const rows = all<{ id: string; owner_id: string; handle: string; kind: string; mime: string; bytes: number; recipe_id: string | null; post_id: string | null; created_at: string }>(
      db,
      `SELECT m.id, m.owner_id, u.handle, m.kind, m.mime, m.bytes, m.recipe_id, m.post_id, m.created_at FROM media m JOIN users u ON u.id = m.owner_id ORDER BY m.created_at DESC LIMIT 300`,
    );
    res.json({ media: rows.map((x) => ({ id: x.id, ownerId: x.owner_id, handle: x.handle, kind: x.kind, mime: x.mime, bytes: x.bytes, recipeId: x.recipe_id, postId: x.post_id, createdAt: x.created_at })) });
  });

  r.delete('/media/:id', async (req, res, next) => {
    try {
      const row = one<{ id: string; owner_id: string }>(db, 'SELECT id, owner_id FROM media WHERE id = ?', req.params['id']);
      if (!row) throw notFound('No such file.');
      await mediaStore.remove(row.id);
      audit.record(req.user!.id, 'media.delete', 'media', row.id, { owner: row.owner_id });
      res.json({ ok: true });
    } catch (e) {
      next(e);
    }
  });

  // ---- generations ------------------------------------------------------------------------
  interface GenRow { id: string; user_id: string; display_name: string | null; vendor: string; model: string; status: 'ok' | 'failed'; latency_ms: number; input_tokens: number | null; output_tokens: number | null; error_code: string | null; recipe_id: string | null; created_at: string }
  const GEN_SELECT = `SELECT g.*, u.display_name FROM generations g LEFT JOIN users u ON u.id = g.user_id`;
  const toGen = (g: GenRow): GenerationLog => ({
    id: g.id, userId: g.user_id, userDisplayName: g.display_name, vendor: g.vendor, model: g.model, status: g.status, latencyMs: g.latency_ms,
    inputTokens: g.input_tokens, outputTokens: g.output_tokens, errorCode: g.error_code, recipeId: g.recipe_id, createdAt: g.created_at,
  });

  r.get('/generations', (req, res) => {
    const status = req.query['status'] === 'ok' || req.query['status'] === 'failed' ? req.query['status'] : null;
    const rows = status
      ? all<GenRow>(db, `${GEN_SELECT} WHERE g.status = ? ORDER BY g.created_at DESC LIMIT 200`, status)
      : all<GenRow>(db, `${GEN_SELECT} ORDER BY g.created_at DESC LIMIT 200`);
    res.json({ generations: rows.map(toGen) });
  });

  // ---- settings & audit -------------------------------------------------------------------
  r.get('/settings', (_req, res) => {
    res.json({
      settings: settings.get(),
      server: {
        env: config.env,
        providers: providerIds,
        mockEnabled: config.enableMockProvider,
        models: { anthropic: config.anthropic.model, openai: config.openai.model },
        uploadDir: mediaStore.root,
        bootstrapFirstAdmin: config.bootstrapFirstAdmin,
        adminEmails: config.adminEmails,
        cookieSecure: config.cookieSecure,
      },
    });
  });

  r.put('/settings', (req, res) => {
    const patch = parse(AppSettingsSchema.partial(), req.body);
    const next = settings.update(patch);
    audit.record(req.user!.id, 'settings.update', 'settings', null, patch);
    res.json({ settings: next });
  });

  r.get('/audit', (_req, res) => {
    const rows = all<{ id: string; actor_id: string; display_name: string | null; action: string; target_type: string; target_id: string | null; detail: string | null; created_at: string }>(
      db,
      `SELECT a.*, u.display_name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ORDER BY a.created_at DESC LIMIT 300`,
    );
    const entries: AuditEntry[] = rows.map((x) => ({ id: x.id, actorId: x.actor_id, actorDisplayName: x.display_name, action: x.action, targetType: x.target_type, targetId: x.target_id, detail: x.detail, createdAt: x.created_at }));
    res.json({ entries });
  });

  r.post('/maintenance/purge-sessions', (req, res) => {
    store.purgeExpiredSessions();
    audit.record(req.user!.id, 'maintenance.purge_sessions', 'system', null);
    res.json({ ok: true });
  });

  return r;
}

