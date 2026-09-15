import type { Request } from 'express';
import type { Role } from '@foodi/shared';
import type { UserRow } from '../auth/store.js';

declare global {
  namespace Express {
    interface Request {
      user?: UserRow;
      sessionToken?: string;
      requestId: string;
    }
  }
}

export function currentUser(req: Request): UserRow {
  if (!req.user) throw new Error('currentUser called on an unauthenticated request');
  return req.user;
}

export function hasRole(user: UserRow, role: Role): boolean {
  return user.role === role;
}
