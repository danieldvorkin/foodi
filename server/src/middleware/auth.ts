import type { NextFunction, Request, Response } from 'express';
import type { Role } from '@foodi/shared';
import { readCookie, SESSION_COOKIE } from '../auth/cookies.js';
import type { AuthStore } from '../auth/store.js';
import { forbidden, unauthorized } from '../lib/errors.js';

/** Resolves the session cookie to a user on every request; does not itself reject. */
export function attachUser(store: AuthStore) {
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, SESSION_COOKIE);
    if (token) {
      const user = store.getSessionUser(token);
      if (user) {
        req.user = user;
        req.sessionToken = token;
      }
    }
    next();
  };
}

export function requireAuth(req: Request, _res: Response, next: NextFunction) {
  if (!req.user) return next(unauthorized());
  next();
}

export function requireRole(role: Role) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (req.user.role !== role) return next(forbidden());
    next();
  };
}
