import { parse, serialize } from 'cookie';
import type { Request, Response } from 'express';
import { decrypt, encrypt } from '../lib/crypto.js';

export const SESSION_COOKIE = 'foodi_session';
export const OAUTH_COOKIE = 'foodi_oauth';

export interface CookieOptions {
  secure: boolean;
}

export function readCookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  return parse(header)[name];
}

export function setSessionCookie(res: Response, token: string, expiresAt: string, opts: CookieOptions) {
  res.append(
    'set-cookie',
    serialize(SESSION_COOKIE, token, {
      httpOnly: true,
      secure: opts.secure,
      sameSite: 'lax',
      path: '/',
      expires: new Date(expiresAt),
    }),
  );
}

export function clearSessionCookie(res: Response, opts: CookieOptions) {
  res.append('set-cookie', serialize(SESSION_COOKIE, '', { httpOnly: true, secure: opts.secure, sameSite: 'lax', path: '/', maxAge: 0 }));
}

/** The in-flight OAuth transaction (state, PKCE verifier, nonce) lives in an encrypted,
 *  short-lived cookie so the server stays stateless across the redirect. */
export function setOAuthCookie(res: Response, payload: Record<string, string>, key: Buffer, opts: CookieOptions) {
  res.append(
    'set-cookie',
    serialize(OAUTH_COOKIE, encrypt(JSON.stringify({ ...payload, iat: Date.now() }), key), {
      httpOnly: true,
      secure: opts.secure,
      sameSite: 'lax',
      path: '/api/auth',
      maxAge: 10 * 60,
    }),
  );
}

export function readOAuthCookie(req: Request, key: Buffer): Record<string, string> | null {
  const raw = readCookie(req, OAUTH_COOKIE);
  if (!raw) return null;
  try {
    const data = JSON.parse(decrypt(raw, key)) as Record<string, string> & { iat?: number };
    if (!data.iat || Date.now() - Number(data.iat) > 10 * 60_000) return null;
    return data;
  } catch {
    return null;
  }
}

export function clearOAuthCookie(res: Response, opts: CookieOptions) {
  res.append('set-cookie', serialize(OAUTH_COOKIE, '', { httpOnly: true, secure: opts.secure, sameSite: 'lax', path: '/api/auth', maxAge: 0 }));
}
