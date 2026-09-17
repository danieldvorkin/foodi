import type { Job } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import type { Logger } from '../lib/logger.js';
import { addMs, now } from '../lib/time.js';
import type { Notifier } from './notify.js';

/** Thrown by a handler to control retries. Anything else thrown is treated as retryable. */
export class JobError extends Error {
  constructor(
    public code: string,
    message: string,
    public retryable: boolean,
  ) {
    super(message);
    this.name = 'JobError';
  }
}

export type JobHandler = (job: JobRow) => Promise<{ recipeId?: string }>;

export interface JobRow {
  id: string;
  kind: Job['kind'];
  user_id: string;
  payload: string;
  status: Job['status'];
  attempts: number;
  max_attempts: number;
  last_error: string | null;
  last_error_code: string | null;
  result_recipe_id: string | null;
  created_at: string;
  run_after: string;
  started_at: string | null;
  finished_at: string | null;
}

/** Backoff between attempts: 5 s, 30 s, 2 min. */
const BACKOFF_MS = [5_000, 30_000, 120_000];
const STUCK_AFTER_MS = 5 * 60_000;

export function toJob(db: Db, x: JobRow): Job {
  let prompt = '';
  try {
    const p = JSON.parse(x.payload) as { prompt?: string; ingredientIds?: string[]; basedOnRecipeId?: string };
    prompt = p.prompt || (p.basedOnRecipeId ? 'Adjusting a recipe' : p.ingredientIds?.length ? `Something with ${p.ingredientIds.length} picked ingredients` : 'Surprise me');
  } catch {
    /* keep empty */
  }
  const title = x.result_recipe_id ? one<{ title: string }>(db, 'SELECT title FROM recipes WHERE id = ?', x.result_recipe_id)?.title ?? null : null;
  return {
    id: x.id,
    kind: x.kind,
    status: x.status,
    prompt,
    attempts: x.attempts,
    maxAttempts: x.max_attempts,
    lastError: x.last_error,
    lastErrorCode: x.last_error_code,
    recipeId: x.result_recipe_id,
    recipeTitle: title,
    createdAt: x.created_at,
    runAfter: x.run_after,
    startedAt: x.started_at,
    finishedAt: x.finished_at,
  };
}

/**
 * A small job queue on the app's own SQLite: enqueue returns immediately, a poller in this
 * process claims one job at a time per slot, retries with backoff, and pushes progress to the
 * owner's open tabs over the notification stream. Good for one machine; swap for a real queue
 * if workers ever run elsewhere.
 */
export function createJobs(db: Db, notifier: Notifier, log: Logger, opts: { concurrency?: number; pollMs?: number } = {}) {
  const handlers = new Map<string, JobHandler>();
  const concurrency = opts.concurrency ?? 2;
  const pollMs = opts.pollMs ?? 1000;
  let running = 0;
  let timer: NodeJS.Timeout | null = null;

  function register(kind: Job['kind'], fn: JobHandler) {
    handlers.set(kind, fn);
  }

  function publish(row: JobRow) {
    notifier.publish(row.user_id, 'job', toJob(db, row));
  }

  function enqueue(kind: Job['kind'], userId: string, payload: unknown, maxAttempts = 3): Job {
    const id = newId('job');
    const t = now();
    run(db, `INSERT INTO jobs (id, kind, user_id, payload, status, attempts, max_attempts, created_at, run_after) VALUES (?, ?, ?, ?, 'queued', 0, ?, ?, ?)`, id, kind, userId, JSON.stringify(payload), maxAttempts, t, t);
    const row = get(id)!;
    publish(row);
    kick();
    return toJob(db, row);
  }

  function get(id: string): JobRow | undefined {
    return one<JobRow>(db, 'SELECT * FROM jobs WHERE id = ?', id);
  }
  function listFor(userId: string, activeOnly = false): Job[] {
    const rows = activeOnly
      ? all<JobRow>(db, `SELECT * FROM jobs WHERE user_id = ? AND status IN ('queued','running') ORDER BY created_at DESC`, userId)
      : all<JobRow>(db, 'SELECT * FROM jobs WHERE user_id = ? ORDER BY created_at DESC LIMIT 50', userId);
    return rows.map((r) => toJob(db, r));
  }
  function listAll(limit = 200): Job[] {
    return all<JobRow>(db, `SELECT * FROM jobs ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'queued' THEN 1 WHEN 'failed' THEN 2 ELSE 3 END, created_at DESC LIMIT ?`, limit).map((r) => toJob(db, r));
  }
  function activeCount(userId: string): number {
    return one<{ n: number }>(db, `SELECT COUNT(*) AS n FROM jobs WHERE user_id = ? AND status IN ('queued','running')`, userId)!.n;
  }

  function cancel(id: string, userId: string | null): boolean {
    const r = run(db, `UPDATE jobs SET status = 'cancelled', finished_at = ? WHERE id = ? AND status = 'queued'${userId ? ' AND user_id = ?' : ''}`, ...(userId ? [now(), id, userId] : [now(), id]));
    const row = get(id);
    if (row && r.changes > 0) publish(row);
    return r.changes > 0;
  }
  function retry(id: string, userId: string | null): boolean {
    const r = run(db, `UPDATE jobs SET status = 'queued', attempts = 0, last_error = NULL, last_error_code = NULL, run_after = ?, finished_at = NULL WHERE id = ? AND status IN ('failed','cancelled')${userId ? ' AND user_id = ?' : ''}`, ...(userId ? [now(), id, userId] : [now(), id]));
    const row = get(id);
    if (row && r.changes > 0) {
      publish(row);
      kick();
    }
    return r.changes > 0;
  }

  /** Jobs left 'running' by a crash or deploy go back in the queue. */
  function recover() {
    const cutoff = new Date(Date.now() - STUCK_AFTER_MS).toISOString();
    const r = run(db, `UPDATE jobs SET status = 'queued', run_after = ? WHERE status = 'running' AND started_at < ?`, now(), cutoff);
    // Anything 'running' at boot cannot actually be running — this process just started.
    const r2 = run(db, `UPDATE jobs SET status = 'queued', run_after = ? WHERE status = 'running'`, now());
    const requeued = Number(r.changes) + Number(r2.changes);
    if (requeued) log.info({ requeued }, 'jobs recovered after restart');
  }

  /** Claim and run one job if a slot is free. Returns whether anything was picked up. */
  async function tick(): Promise<boolean> {
    if (running >= concurrency) return false;
    const next = one<JobRow>(db, `SELECT * FROM jobs WHERE status = 'queued' AND run_after <= ? ORDER BY created_at ASC LIMIT 1`, now());
    if (!next) return false;
    const claimed = run(db, `UPDATE jobs SET status = 'running', attempts = attempts + 1, started_at = ? WHERE id = ? AND status = 'queued'`, now(), next.id);
    if (claimed.changes === 0) return false; // someone else got it
    running++;
    const row = get(next.id)!;
    publish(row);
    const handler = handlers.get(row.kind);
    try {
      if (!handler) throw new JobError('no_handler', `No handler for ${row.kind}`, false);
      const out = await handler(row);
      run(db, `UPDATE jobs SET status = 'done', finished_at = ?, result_recipe_id = ?, last_error = NULL, last_error_code = NULL WHERE id = ?`, now(), out.recipeId ?? null, row.id);
      log.info({ job: row.id, kind: row.kind, attempts: row.attempts }, 'job done');
    } catch (err) {
      const e = err as Partial<JobError> & Error;
      const retryable = err instanceof JobError ? err.retryable : true;
      const exhausted = row.attempts >= row.max_attempts;
      if (retryable && !exhausted) {
        const delay = BACKOFF_MS[Math.min(row.attempts - 1, BACKOFF_MS.length - 1)]!;
        run(db, `UPDATE jobs SET status = 'queued', run_after = ?, last_error = ?, last_error_code = ? WHERE id = ?`, addMs(delay), e.message ?? 'failed', e.code ?? 'error', row.id);
        log.warn({ job: row.id, attempt: row.attempts, retryInMs: delay, code: e.code }, 'job failed, will retry');
      } else {
        run(db, `UPDATE jobs SET status = 'failed', finished_at = ?, last_error = ?, last_error_code = ? WHERE id = ?`, now(), e.message ?? 'failed', e.code ?? 'error', row.id);
        log.warn({ job: row.id, attempts: row.attempts, code: e.code }, 'job failed for good');
      }
    } finally {
      running--;
      const after = get(row.id);
      if (after) publish(after);
      // Something else may be waiting behind this one.
      setTimeout(kick, 0).unref();
    }
    return true;
  }

  /**
   * Fill free slots. `tick()` claims synchronously (no await before the claim), so a change in
   * `running` tells us whether it picked something up; the handler itself runs in the background.
   */
  function drain() {
    while (running < concurrency) {
      const before = running;
      void tick().catch((e) => log.error({ err: e }, 'job tick failed'));
      if (running === before) break;
    }
  }
  function kick() {
    try {
      drain();
    } catch (e) {
      log.error({ err: e }, 'job drain failed');
    }
  }

  function start() {
    recover();
    if (timer) return;
    timer = setInterval(kick, pollMs);
    timer.unref();
    kick();
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = null;
  }

  /** Wait until nothing is queued or running (tests). */
  async function idle(timeoutMs = 10_000) {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const busy = running > 0 || one(db, `SELECT 1 FROM jobs WHERE status IN ('queued','running') AND run_after <= ? LIMIT 1`, now());
      if (!busy) return;
      await new Promise((r) => setTimeout(r, 25));
      kick();
    }
  }

  return { register, enqueue, get: (id: string) => (get(id) ? toJob(db, get(id)!) : null), getRow: get, listFor, listAll, activeCount, cancel, retry, start, stop, tick, idle, recover };
}
export type Jobs = ReturnType<typeof createJobs>;
