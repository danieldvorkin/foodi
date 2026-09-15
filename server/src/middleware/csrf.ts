import type { NextFunction, Request, Response } from 'express';
import { forbidden } from '../lib/errors.js';

const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

/**
 * Cross-site request forgery defence for cookie-authenticated JSON APIs: every state-changing
 * request must come from our own origin. Combined with SameSite=Lax cookies and a JSON-only
 * body parser this closes the classic form-post CSRF vector without per-request tokens.
 */
export function csrfOriginCheck(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.replace(/\/$/, '')));
  return (req: Request, _res: Response, next: NextFunction) => {
    if (SAFE.has(req.method)) return next();
    const fetchSite = req.headers['sec-fetch-site'];
    if (fetchSite === 'same-origin') return next();
    const origin = req.headers.origin ?? (req.headers.referer ? safeOrigin(req.headers.referer) : undefined);
    if (origin && allowed.has(origin)) return next();
    next(forbidden('This request did not come from foodi.'));
  };
}

function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin;
  } catch {
    return undefined;
  }
}
