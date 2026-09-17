import type { AuthStore } from '../auth/store.js';
import type { OpenAiAdmin } from '../ai/openai-admin.js';
import { AiError } from '../ai/types.js';
import type { Db } from '../db/index.js';
import { one, run } from '../db/index.js';
import type { Logger } from '../lib/logger.js';
import { now } from '../lib/time.js';
import type { Jobs } from './jobs.js';
import { JobError, type JobRow } from './jobs.js';
import type { Settings } from './settings.js';

/**
 * Keys foodi hands out. When an organisation admin key is configured and the admin setting is
 * on, every person who finishes onboarding without an AI of their own gets an OpenAI service
 * account under foodi's project, and its key becomes their credential (kind 'managed'). Bringing
 * their own key, or removing foodi's, deletes the service account so nothing dangles.
 *
 * The project id lives in the settings table (or comes from OPENAI_PROJECT_ID).
 */
export function createManagedKeys(deps: { db: Db; store: AuthStore; settings: Settings; admin: OpenAiAdmin | null; projectId: string | undefined; appName: string; log: Logger }) {
  const { db, store, settings, admin, log } = deps;

  function configured(): boolean {
    return admin !== null;
  }
  /** Feature on and able to run. */
  function enabled(): boolean {
    return configured() && settings.get().openaiManagedKeys;
  }

  function storedProjectId(): string | null {
    if (deps.projectId) return deps.projectId;
    return one<{ value: string }>(db, `SELECT value FROM settings WHERE key = 'openaiProjectId'`)?.value ?? null;
  }
  async function projectId(): Promise<string> {
    if (!admin) throw new AiError('vendor_error', 'Managed keys are not configured.');
    const existing = storedProjectId();
    if (existing) {
      if (deps.projectId) return existing;
      const p = await admin.getProject(existing);
      if (p && p.status === 'active') return existing;
      log.warn({ projectId: existing }, 'stored OpenAI project is gone or archived; creating a new one');
    }
    const created = await admin.createProject(`${deps.appName} people`);
    run(db, `INSERT INTO settings (key, value, updated_at) VALUES ('openaiProjectId', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`, created.id, now());
    return created.id;
  }

  /** Does this person need a key from us? Only when they finished onboarding and have nothing connected. */
  function wants(userId: string): boolean {
    if (!enabled()) return false;
    if (store.getCredentialMeta(userId)) return false;
    return Boolean(one(db, 'SELECT 1 FROM profiles WHERE user_id = ?', userId));
  }

  /** Queue a key for this person unless one is already on its way (or failed in the last hour). */
  function ensureFor(jobs: Jobs, userId: string): boolean {
    if (!wants(userId)) return false;
    const recent = one(
      db,
      `SELECT 1 FROM jobs WHERE user_id = ? AND kind = 'provision' AND (status IN ('queued','running') OR (status = 'failed' AND created_at > ?))`,
      userId,
      new Date(Date.now() - 3600_000).toISOString(),
    );
    if (recent) return false;
    jobs.enqueue('provision', userId, {}, 2, null);
    return true;
  }

  /** Create the service account and store its key as the person's credential. Idempotent. */
  async function provision(userId: string): Promise<'created' | 'skipped'> {
    if (!admin) throw new AiError('vendor_error', 'Managed keys are not configured.');
    if (!wants(userId)) return 'skipped';
    const user = one<{ handle: string }>(db, 'SELECT handle FROM users WHERE id = ?', userId);
    if (!user) return 'skipped';
    const pid = await projectId();
    const sa = await admin.createServiceAccount(pid, `${deps.appName} @${user.handle} ${userId.slice(-6)}`);
    // Someone may have connected their own key while we were waiting: don't clobber it.
    if (store.getCredentialMeta(userId)) {
      await admin.deleteServiceAccount(pid, sa.id).catch(() => {});
      return 'skipped';
    }
    store.setCredential(userId, 'openai', { kind: 'managed', apiKey: sa.apiKey, projectId: pid, serviceAccountId: sa.id, keyId: sa.keyId });
    log.info({ userId, serviceAccountId: sa.id }, 'managed OpenAI key issued');
    return 'created';
  }

  /** Delete the service account behind a managed credential (best effort) — before it is replaced or removed. */
  async function revoke(userId: string): Promise<boolean> {
    const cred = store.getCredential(userId);
    if (!cred || cred.payload.kind !== 'managed') return false;
    if (admin) {
      try {
        await admin.deleteServiceAccount(cred.payload.projectId, cred.payload.serviceAccountId);
      } catch (err) {
        log.warn({ err, userId }, 'could not delete managed service account');
      }
    }
    return true;
  }

  /** Used today by a person on a managed key, for the UI. */
  function usedToday(userId: string): number {
    const since = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
    return one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM generations WHERE user_id = ? AND created_at > ? AND status = 'ok' AND kind = 'recipe'`, userId, since)!.n;
  }

  /** The job handler: one attempt to issue a key; vendor errors retry, config errors don't. */
  function jobHandler() {
    return async (job: JobRow) => {
      try {
        await provision(job.user_id);
        return {};
      } catch (err) {
        if (err instanceof AiError) throw new JobError(err.code, err.message, err.code === 'network' || err.code === 'rate_limited' || err.code === 'vendor_error');
        throw err;
      }
    };
  }

  return { configured, enabled, wants, ensureFor, provision, revoke, usedToday, jobHandler, storedProjectId };
}

export type ManagedKeys = ReturnType<typeof createManagedKeys>;
