import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (password: string, salt: Buffer, keylen: number, opts: { N: number; r: number; p: number; maxmem: number }) => Promise<Buffer>;

// scrypt parameters per OWASP guidance (N=2^17, r=8, p=1 ≈ 128 MiB, ~100 ms on a laptop).
const PARAMS = { N: 2 ** 17, r: 8, p: 1, maxmem: 256 * 1024 * 1024 };
const KEYLEN = 32;

/** Format: scrypt$N$r$p$<salt b64url>$<hash b64url> so parameters can be raised later. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await scrypt(password.normalize('NFKC'), salt, KEYLEN, PARAMS);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64url'), hash.toString('base64url')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, n, r, p, saltB64, hashB64] = stored.split('$');
  if (alg !== 'scrypt' || !n || !r || !p || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64url');
  const actual = await scrypt(password.normalize('NFKC'), Buffer.from(saltB64, 'base64url'), expected.length, { N: Number(n), r: Number(r), p: Number(p), maxmem: PARAMS.maxmem });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** Should the stored hash be upgraded to current parameters on next successful login? */
export function needsRehash(stored: string): boolean {
  const [, n, r, p] = stored.split('$');
  return Number(n) !== PARAMS.N || Number(r) !== PARAMS.r || Number(p) !== PARAMS.p;
}

const COMMON = new Set(['password', 'password1', 'passw0rd', '1234567890', 'qwertyuiop', 'iloveyou12', 'letmein123', 'welcome123', 'admin12345', 'changeme123']);

/** Cheap, deterministic checks; length does most of the work. */
export function passwordProblem(password: string, email: string): string | null {
  if (password.length < 10) return 'Use at least 10 characters.';
  if (password.length > 200) return 'That is longer than we can store.';
  const lower = password.toLowerCase();
  if (COMMON.has(lower)) return 'That password is on every breach list. Pick something else.';
  const local = email.toLowerCase().split('@')[0] ?? '';
  if (local.length >= 3 && lower.includes(local)) return 'Don’t reuse your email in the password.';
  if (/^(.)\1+$/.test(password)) return 'Mix it up a little.';
  return null;
}
