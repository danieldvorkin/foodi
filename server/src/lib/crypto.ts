import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const ALG = 'aes-256-gcm';
const IV_BYTES = 12;
const VERSION = 'v1';

/** Encrypt a UTF-8 string. Output: v1.<iv>.<ciphertext>.<tag>, all base64url. */
export function encrypt(plaintext: string, key: Buffer): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALG, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return [VERSION, b64(iv), b64(ct), b64(tag)].join('.');
}

export function decrypt(payload: string, key: Buffer): string {
  const [version, iv, ct, tag] = payload.split('.');
  if (version !== VERSION || !iv || !ct || !tag) throw new Error('Malformed ciphertext');
  const decipher = createDecipheriv(ALG, key, unb64(iv));
  decipher.setAuthTag(unb64(tag));
  return Buffer.concat([decipher.update(unb64(ct)), decipher.final()]).toString('utf8');
}

export function randomToken(bytes = 32): string {
  return b64(randomBytes(bytes));
}

export function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

export function hmac(secret: string, input: string): string {
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** PKCE (RFC 7636): verifier is 43–128 chars; challenge is S256. */
export function pkcePair() {
  const verifier = b64(randomBytes(48));
  const challenge = b64(createHash('sha256').update(verifier).digest());
  return { verifier, challenge };
}

export function b64(buf: Buffer): string {
  return buf.toString('base64url');
}
export function unb64(s: string): Buffer {
  return Buffer.from(s, 'base64url');
}

export function newId(prefix: string): string {
  return `${prefix}_${b64(randomBytes(12))}`;
}
