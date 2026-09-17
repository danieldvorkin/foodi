import type { NextFunction, Request, Response } from 'express';
import { ADMIN_PERMISSION_IDS, type AdminPermission } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { forbidden, unauthorized } from '../lib/errors.js';
import { now } from '../lib/time.js';

/** Granular admin rights on top of the 'admin' role. Consumers never have any. */
export function createPermissions(db: Db) {
  function list(userId: string): AdminPermission[] {
    return all<{ permission: string }>(db, 'SELECT permission FROM admin_permissions WHERE user_id = ? ORDER BY permission', userId)
      .map((r) => r.permission)
      .filter((p): p is AdminPermission => (ADMIN_PERMISSION_IDS as readonly string[]).includes(p));
  }
  function has(user: { id: string; role: string } | undefined, permission: AdminPermission): boolean {
    if (!user || user.role !== 'admin') return false;
    return Boolean(one(db, 'SELECT 1 FROM admin_permissions WHERE user_id = ? AND permission = ?', user.id, permission));
  }
  function set(userId: string, permissions: AdminPermission[], grantedBy: string) {
    tx(db, () => {
      run(db, 'DELETE FROM admin_permissions WHERE user_id = ?', userId);
      for (const p of new Set(permissions)) run(db, 'INSERT INTO admin_permissions (user_id, permission, granted_by, created_at) VALUES (?, ?, ?, ?)', userId, p, grantedBy, now());
    });
  }
  /** Express guard: admin role *and* the named permission. */
  function require(permission: AdminPermission) {
    return (req: Request, _res: Response, next: NextFunction) => {
      if (!req.user) return next(unauthorized());
      if (!has(req.user, permission)) return next(forbidden(`This needs the “${permission}” permission. Another admin can grant it under People.`));
      next();
    };
  }
  return { list, has, set, require };
}
export type Permissions = ReturnType<typeof createPermissions>;
