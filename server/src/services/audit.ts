import type { Db } from '../db/index.js';
import { run } from '../db/index.js';
import { newId } from '../lib/crypto.js';
import { now } from '../lib/time.js';

export function createAudit(db: Db) {
  return {
    record(actorId: string, action: string, targetType: string, targetId: string | null, detail?: Record<string, unknown>) {
      run(
        db,
        `INSERT INTO audit_log (id, actor_id, action, target_type, target_id, detail, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        newId('aud'),
        actorId,
        action,
        targetType,
        targetId,
        detail ? JSON.stringify(detail) : null,
        now(),
      );
    },
  };
}
export type Audit = ReturnType<typeof createAudit>;
