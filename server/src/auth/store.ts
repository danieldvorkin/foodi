import type { Role, Vendor } from '@foodi/shared';
import type { Db } from '../db/index.js';
import { all, one, run, tx } from '../db/index.js';
import { decrypt, encrypt, newId, randomToken, sha256 } from '../lib/crypto.js';
import { addMs, days, minutes, now } from '../lib/time.js';
import type { CredentialPayload, Identity } from './providers/types.js';

export interface UserRow {
  id: string;
  role: Role;
  display_name: string | null;
  email: string | null;
  handle: string;
  bio: string;
  avatar_emoji: string;
  disabled_at: string | null;
  created_at: string;
  last_seen_at: string | null;
}

export interface CredentialRow {
  user_id: string;
  vendor: Vendor;
  kind: 'oauth' | 'api_key';
  payload_enc: string;
  expires_at: string | null;
  updated_at: string;
  hint: string | null;
}

const SESSION_TTL = days(30);
const SESSION_TOUCH_INTERVAL = minutes(5);

export function createAuthStore(db: Db, opts: { encryptionKey: Buffer; bootstrapFirstAdmin: boolean; adminEmails: string[] }) {
  function findUserByIdentity(identity: Identity): UserRow | undefined {
    return one<UserRow>(
      db,
      `SELECT u.* FROM identities i JOIN users u ON u.id = i.user_id WHERE i.provider = ? AND i.subject = ?`,
      identity.provider,
      identity.subject,
    );
  }

  function uniqueHandle(seed: string | null): string {
    const base =
      (seed ?? 'cook')
        .toLowerCase()
        .replace(/@.*$/, '')
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '')
        .slice(0, 14) || 'cook';
    let candidate = base.length >= 3 ? base : `${base}_cook`;
    while (one(db, 'SELECT 1 FROM users WHERE handle = ?', candidate)) {
      candidate = `${base.slice(0, 12)}_${Math.floor(Math.random() * 9000 + 1000)}`;
    }
    return candidate;
  }

  /** Admin by email list only when the provider verified the address; never from a self-typed email. */
  function isListedAdmin(identity: Identity): boolean {
    return Boolean(identity.email && identity.emailVerified && opts.adminEmails.includes(identity.email.toLowerCase()));
  }

  function initialRole(identity: Identity): Role {
    if (isListedAdmin(identity)) return 'admin';
    if (opts.bootstrapFirstAdmin) {
      const anyAdmin = one(db, `SELECT 1 FROM users WHERE role = 'admin' LIMIT 1`);
      if (!anyAdmin) return 'admin';
    }
    return 'consumer';
  }

  function insertUser(identity: Identity): UserRow {
    const id = newId('usr');
    const t = now();
    run(
      db,
      `INSERT INTO users (id, role, display_name, email, handle, created_at, last_seen_at) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      id,
      initialRole(identity),
      identity.displayName,
      identity.email,
      uniqueHandle(identity.displayName ?? identity.email),
      t,
      t,
    );
    addIdentity(id, identity);
    return one<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id)!;
  }

  function addIdentity(userId: string, identity: Identity) {
    run(
      db,
      `INSERT INTO identities (id, user_id, provider, subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)`,
      newId('idn'),
      userId,
      identity.provider,
      identity.subject,
      identity.email,
      now(),
    );
  }

  /** Find-or-create the user for an SSO identity and store the credential it came with. */
  function signIn(identity: Identity, credential: CredentialPayload, vendor: Vendor): UserRow {
    return tx(db, () => {
      let user = findUserByIdentity(identity);
      const t = now();
      if (!user) {
        user = insertUser(identity);
      } else {
        // Promote by email list on every sign-in so ops can add admins without a restart.
        if (isListedAdmin(identity) && user.role !== 'admin') {
          run(db, `UPDATE users SET role = 'admin' WHERE id = ?`, user.id);
          user.role = 'admin';
        }
        run(db, 'UPDATE users SET last_seen_at = ? WHERE id = ?', t, user.id);
      }
      setCredential(user.id, vendor, credential);
      return user;
    });
  }

  /** Attach an SSO identity (and its credential) to an already signed-in user. */
  function linkIdentity(userId: string, identity: Identity, credential: CredentialPayload, vendor: Vendor): { ok: true } | { ok: false; reason: 'taken' } {
    return tx(db, () => {
      const existing = findUserByIdentity(identity);
      if (existing && existing.id !== userId) return { ok: false, reason: 'taken' as const };
      if (!existing) addIdentity(userId, identity);
      setCredential(userId, vendor, credential);
      return { ok: true as const };
    });
  }

  // ---- email + password ---------------------------------------------------------------
  function findPasswordUser(email: string): (UserRow & { hash: string }) | undefined {
    return one<UserRow & { hash: string }>(
      db,
      `SELECT u.*, p.hash FROM identities i JOIN users u ON u.id = i.user_id JOIN passwords p ON p.user_id = u.id WHERE i.provider = 'password' AND i.subject = ?`,
      email,
    );
  }

  /** Is this email already attached to any account (password login, provider identity, or profile)? */
  function emailInUse(email: string, exceptUserId: string | null = null): boolean {
    return Boolean(
      one(
        db,
        `SELECT 1 FROM (
           SELECT user_id FROM identities WHERE (provider = 'password' AND subject = ?) OR lower(email) = ?
           UNION ALL SELECT id AS user_id FROM users WHERE lower(email) = ?
         ) WHERE user_id IS NOT ?`,
        email,
        email,
        email,
        exceptUserId,
      ),
    );
  }

  function register(input: { email: string; displayName: string; passwordHash: string }): UserRow | null {
    return tx(db, () => {
      // One account per email, whichever way it signed in. Otherwise a password registration
      // could shadow an SSO account's email (and vice versa) and confuse email-based admin tooling.
      if (emailInUse(input.email)) return null;
      const user = insertUser({ provider: 'password', subject: input.email, email: input.email, emailVerified: false, displayName: input.displayName });
      run(db, 'INSERT INTO passwords (user_id, hash, updated_at) VALUES (?, ?, ?)', user.id, input.passwordHash, now());
      return user;
    });
  }

  /** Give an SSO-only account an email + password login. */
  function addPasswordLogin(userId: string, email: string, hash: string): { ok: true } | { ok: false; reason: 'taken' } {
    return tx(db, () => {
      if (emailInUse(email, userId)) return { ok: false, reason: 'taken' as const };
      const havePassword = one(db, `SELECT 1 FROM identities WHERE provider = 'password' AND user_id = ?`, userId);
      if (!havePassword) addIdentity(userId, { provider: 'password', subject: email, email, emailVerified: false, displayName: null });
      run(db, 'UPDATE users SET email = COALESCE(email, ?) WHERE id = ?', email, userId);
      setPasswordHash(userId, hash);
      return { ok: true as const };
    });
  }

  function getPasswordHash(userId: string): string | null {
    return one<{ hash: string }>(db, 'SELECT hash FROM passwords WHERE user_id = ?', userId)?.hash ?? null;
  }

  function setPasswordHash(userId: string, hash: string) {
    run(db, `INSERT INTO passwords (user_id, hash, updated_at) VALUES (?, ?, ?) ON CONFLICT(user_id) DO UPDATE SET hash = excluded.hash, updated_at = excluded.updated_at`, userId, hash, now());
  }

  function touch(userId: string) {
    run(db, 'UPDATE users SET last_seen_at = ? WHERE id = ?', now(), userId);
  }

  /** Attach a credential to an existing signed-in user (e.g. switching from OAuth to a key). */
  function setCredential(userId: string, vendor: Vendor, credential: CredentialPayload) {
    const expiresAt = credential.kind === 'oauth' ? credential.expiresAt : null;
    // Only the tail of an API key is kept in the clear: enough to tell two keys apart, never enough to use.
    const hint = credential.kind === 'api_key' ? credential.apiKey.slice(-4) : null;
    run(
      db,
      `INSERT INTO credentials (user_id, vendor, kind, payload_enc, expires_at, updated_at, hint) VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET vendor = excluded.vendor, kind = excluded.kind, payload_enc = excluded.payload_enc,
       expires_at = excluded.expires_at, updated_at = excluded.updated_at, hint = excluded.hint`,
      userId,
      vendor,
      credential.kind,
      encrypt(JSON.stringify(credential), opts.encryptionKey),
      expiresAt,
      now(),
      hint,
    );
  }

  function clearCredential(userId: string) {
    run(db, 'DELETE FROM credentials WHERE user_id = ?', userId);
  }

  function getCredential(userId: string): { vendor: Vendor; payload: CredentialPayload } | null {
    const row = one<CredentialRow>(db, 'SELECT * FROM credentials WHERE user_id = ?', userId);
    if (!row) return null;
    return { vendor: row.vendor, payload: JSON.parse(decrypt(row.payload_enc, opts.encryptionKey)) as CredentialPayload };
  }

  function getCredentialMeta(userId: string): { vendor: Vendor; kind: 'oauth' | 'api_key'; hint: string | null; updatedAt: string } | null {
    const row = one<Pick<CredentialRow, 'vendor' | 'kind' | 'hint' | 'updated_at'>>(db, 'SELECT vendor, kind, hint, updated_at FROM credentials WHERE user_id = ?', userId);
    return row ? { vendor: row.vendor, kind: row.kind, hint: row.hint, updatedAt: row.updated_at } : null;
  }

  function createSession(userId: string, meta: { ip: string | null; userAgent: string | null }): { token: string; expiresAt: string } {
    const token = randomToken(32);
    const t = now();
    const expiresAt = addMs(SESSION_TTL);
    run(
      db,
      `INSERT INTO sessions (id_hash, user_id, created_at, expires_at, last_seen_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      sha256(token),
      userId,
      t,
      expiresAt,
      t,
      meta.ip,
      meta.userAgent?.slice(0, 200) ?? null,
    );
    return { token, expiresAt };
  }

  function getSessionUser(token: string): UserRow | null {
    const hash = sha256(token);
    const row = one<UserRow & { s_expires: string; s_last: string }>(
      db,
      `SELECT u.*, s.expires_at AS s_expires, s.last_seen_at AS s_last FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id_hash = ?`,
      hash,
    );
    if (!row) return null;
    if (new Date(row.s_expires).getTime() < Date.now()) {
      run(db, 'DELETE FROM sessions WHERE id_hash = ?', hash);
      return null;
    }
    if (row.disabled_at) return null;
    // Sliding expiration, written at most every few minutes to keep reads cheap.
    if (Date.now() - new Date(row.s_last).getTime() > SESSION_TOUCH_INTERVAL) {
      const t = now();
      run(db, 'UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE id_hash = ?', t, addMs(SESSION_TTL), hash);
      run(db, 'UPDATE users SET last_seen_at = ? WHERE id = ?', t, row.id);
    }
    const { s_expires: _e, s_last: _l, ...user } = row;
    return user;
  }

  function destroySession(token: string) {
    run(db, 'DELETE FROM sessions WHERE id_hash = ?', sha256(token));
  }

  function destroyAllSessions(userId: string) {
    run(db, 'DELETE FROM sessions WHERE user_id = ?', userId);
  }

  function purgeExpiredSessions() {
    run(db, 'DELETE FROM sessions WHERE expires_at < ?', now());
  }

  function getUser(id: string): UserRow | undefined {
    return one<UserRow>(db, 'SELECT * FROM users WHERE id = ?', id);
  }

  function hasProfile(userId: string): boolean {
    return Boolean(one(db, 'SELECT 1 FROM profiles WHERE user_id = ?', userId));
  }

  function deleteUser(userId: string) {
    run(db, 'DELETE FROM users WHERE id = ?', userId);
  }

  function listIdentities(userId: string) {
    return all<{ provider: string; email: string | null; created_at: string }>(
      db,
      'SELECT provider, email, created_at FROM identities WHERE user_id = ?',
      userId,
    );
  }

  return {
    findUserByIdentity,
    signIn,
    linkIdentity,
    findPasswordUser,
    register,
    getPasswordHash,
    setPasswordHash,
    addPasswordLogin,
    touch,
    setCredential,
    clearCredential,
    getCredential,
    getCredentialMeta,
    createSession,
    getSessionUser,
    destroySession,
    destroyAllSessions,
    purgeExpiredSessions,
    getUser,
    hasProfile,
    deleteUser,
    listIdentities,
  };
}

export type AuthStore = ReturnType<typeof createAuthStore>;
