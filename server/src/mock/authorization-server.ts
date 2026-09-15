import { Router } from 'express';
import { createHash } from 'node:crypto';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { randomToken } from '../lib/crypto.js';

/**
 * A tiny OpenID Connect provider that only exists in development so the real OAuth code
 * path (discovery → PKCE → code → token → id_token verification) runs end to end with no
 * external accounts. It is never mounted in production.
 */
export const MOCK_PERSONAS = [
  { sub: 'mock-ada', name: 'Ada Lovelace', email: 'ada@example.com', role: 'admin' },
  { sub: 'mock-sam', name: 'Sam Rivera', email: 'sam@example.com', role: 'consumer' },
  { sub: 'mock-priya', name: 'Priya Natarajan', email: 'priya@example.com', role: 'consumer' },
  { sub: 'mock-jo', name: 'Jo Okafor', email: 'jo@example.com', role: 'consumer' },
] as const;
/** Emails the app treats as admins while the mock provider is enabled. */
export const MOCK_ADMIN_EMAILS = MOCK_PERSONAS.filter((p) => p.role === 'admin').map((p) => p.email);

interface PendingCode {
  sub: string;
  name: string;
  email: string;
  nonce: string;
  codeChallenge: string;
  redirectUri: string;
  clientId: string;
  expiresAt: number;
}

export async function createMockAuthorizationServer(opts: { issuer: string; clientId: string; redirectUri: string }) {
  const { publicKey, privateKey } = await generateKeyPair('RS256');
  const jwk = { ...(await exportJWK(publicKey)), kid: 'mock-1', alg: 'RS256', use: 'sig' };
  const codes = new Map<string, PendingCode>();
  const router = Router();

  router.get('/.well-known/openid-configuration', (_req, res) => {
    res.json({
      issuer: opts.issuer,
      authorization_endpoint: `${opts.issuer}/authorize`,
      token_endpoint: `${opts.issuer}/token`,
      jwks_uri: `${opts.issuer}/.well-known/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      code_challenge_methods_supported: ['S256'],
    });
  });

  router.get('/.well-known/jwks.json', (_req, res) => res.json({ keys: [jwk] }));

  router.get('/authorize', (req, res) => {
    const q = req.query as Record<string, string | undefined>;
    if (q['client_id'] !== opts.clientId || q['redirect_uri'] !== opts.redirectUri) {
      res.status(400).type('text').send('mock-oauth: unknown client_id or redirect_uri');
      return;
    }
    if (q['response_type'] !== 'code' || q['code_challenge_method'] !== 'S256' || !q['code_challenge'] || !q['state']) {
      res.status(400).type('text').send('mock-oauth: expected response_type=code with S256 PKCE and state');
      return;
    }
    // login_hint=<sub> skips the chooser — the one-click "mock admin / mock user" buttons use it.
    const hinted = MOCK_PERSONAS.find((p) => p.sub === q['login_hint']);
    if (hinted) {
      res.redirect(303, issueCode(hinted, q as Record<string, string>));
      return;
    }
    const hidden = ['state', 'nonce', 'code_challenge', 'redirect_uri', 'client_id']
      .map((k) => `<input type="hidden" name="${k}" value="${esc(q[k] ?? '')}">`)
      .join('');
    const personas = MOCK_PERSONAS.map(
      (p) => `<button name="sub" value="${p.sub}"><strong>${esc(p.name)}${p.role === 'admin' ? ' · admin' : ''}</strong><span>${esc(p.email)}</span></button>`,
    ).join('');
    res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock sign-in</title>
<style>
:root{color-scheme:light dark}
body{margin:0;min-height:100vh;display:grid;place-items:center;font:16px/1.5 system-ui,sans-serif;background:#FAFAF8;color:#2A2926}
@media(prefers-color-scheme:dark){body{background:#1C1B19;color:#ECEAE4}}
main{width:min(92vw,420px)}
h1{font-size:22px;font-weight:600;margin:0 0 4px}
p{margin:0 0 20px;color:#6F6C66}
form{display:grid;gap:8px}
button{all:unset;display:flex;justify-content:space-between;gap:12px;padding:12px 14px;border:1px solid #E3E1DA;border-radius:10px;cursor:pointer;background:#fff}
@media(prefers-color-scheme:dark){button{background:#242320;border-color:#3A3833}}
button:hover,button:focus-visible{border-color:#5A6B4B;outline:none}
button span{color:#6F6C66;font-size:14px}
small{display:block;margin-top:16px;color:#6F6C66}
</style></head><body><main>
<h1>Mock sign-in</h1><p>A pretend identity provider for local development. Pick who to sign in as.</p>
<form method="post" action="${opts.issuer}/approve">${hidden}${personas}</form>
<small>Runs the same OAuth + PKCE + OIDC code path as a real provider. Ada is an admin; everyone else is a consumer.</small>
</main></body></html>`);
  });

  router.post('/approve', (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const persona = MOCK_PERSONAS.find((p) => p.sub === b['sub']);
    if (!persona || b['client_id'] !== opts.clientId || b['redirect_uri'] !== opts.redirectUri || !b['state'] || !b['code_challenge']) {
      res.status(400).type('text').send('mock-oauth: bad approval');
      return;
    }
    res.redirect(303, issueCode(persona, b as Record<string, string>));
  });

  function issueCode(persona: (typeof MOCK_PERSONAS)[number], q: Record<string, string>): string {
    const code = randomToken(24);
    codes.set(code, {
      sub: persona.sub,
      name: persona.name,
      email: persona.email,
      nonce: q['nonce'] ?? '',
      codeChallenge: q['code_challenge']!,
      redirectUri: q['redirect_uri']!,
      clientId: q['client_id']!,
      expiresAt: Date.now() + 5 * 60_000,
    });
    const url = new URL(q['redirect_uri']!);
    url.searchParams.set('code', code);
    url.searchParams.set('state', q['state']!);
    return url.toString();
  }

  router.post('/token', async (req, res) => {
    const b = (req.body ?? {}) as Record<string, string | undefined>;
    const pending = b['code'] ? codes.get(b['code']) : undefined;
    if (b['grant_type'] !== 'authorization_code' || !pending) {
      res.status(400).json({ error: 'invalid_grant' });
      return;
    }
    codes.delete(b['code']!);
    const verifier = b['code_verifier'] ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      pending.expiresAt < Date.now() ||
      challenge !== pending.codeChallenge ||
      b['redirect_uri'] !== pending.redirectUri ||
      b['client_id'] !== pending.clientId
    ) {
      res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE or redirect mismatch' });
      return;
    }
    const idToken = await new SignJWT({ nonce: pending.nonce, email: pending.email, email_verified: true, name: pending.name })
      .setProtectedHeader({ alg: 'RS256', kid: 'mock-1' })
      .setIssuer(opts.issuer)
      .setAudience(opts.clientId)
      .setSubject(pending.sub)
      .setIssuedAt()
      .setExpirationTime('10m')
      .sign(privateKey);
    res.json({ access_token: `mock-access-${randomToken(12)}`, token_type: 'Bearer', expires_in: 3600, id_token: idToken });
  });

  return router;
}

function esc(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
