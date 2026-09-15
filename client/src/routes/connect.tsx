import { useState, type FormEvent } from 'react';
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../api/client';
import { auth } from '../api/types';
import { Wordmark } from '../components/Logo';
import { requireMe } from '../lib/session';

export async function connectLoader({ params, request }: LoaderFunctionArgs) {
  const me = await requireMe(request);
  const { providers } = await auth.providers();
  const raw = params['vendor'];
  if (raw === undefined) return { vendor: null, provider: null, me, providers };
  if (raw !== 'openai' && raw !== 'anthropic') throw redirect('/connect');
  const vendor: 'openai' | 'anthropic' = raw;
  const provider = providers.find((p) => p.kind === 'api_key' && p.vendor === vendor);
  if (!provider) throw redirect('/connect');
  return { vendor, provider, me, providers };
}

const COPY = {
  anthropic: { title: 'Connect Claude', where: 'console.anthropic.com → API keys', href: 'https://console.anthropic.com/settings/keys', prefix: 'sk-ant-' },
  openai: { title: 'Connect OpenAI', where: 'platform.openai.com → API keys', href: 'https://platform.openai.com/api-keys', prefix: 'sk-' },
} as const;

export function Connect() {
  const { vendor, provider, me, providers } = useLoaderData<typeof connectLoader>();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const after = me.hasProfile ? '/app' : '/onboarding';

  if (!vendor || !provider) {
    const oauth = providers.filter((p) => p.kind === 'oauth');
    return (
      <main className="page-narrow stack-lg" style={{ maxWidth: 620 }}>
        <Wordmark />
        <div className="stack">
          <h1>🔌 Connect your AI</h1>
          <p className="muted measure">
            foodi writes recipes with an AI account you control. Nothing here is billed by foodi; your account does the writing. You can swap or disconnect it any time in Settings.
          </p>
        </div>
        {me.vendor && (
          <div className="notice notice-sage">
            Connected: <b>{me.vendor === 'anthropic' ? 'Claude' : me.vendor === 'openai' ? 'OpenAI' : 'mock account'}</b> ({me.credentialKind === 'oauth' ? 'linked account' : 'API key'}).{' '}
            <Link to={after}>Continue →</Link>
          </div>
        )}
        <div className="connect-grid">
          <Link to="/connect/anthropic" className="connect-card">
            <span className="connect-emoji" aria-hidden="true">🅰️</span>
            <h3>Claude</h3>
            <p className="muted small">Anthropic API key from the Console. Encrypted at rest.</p>
          </Link>
          <Link to="/connect/openai" className="connect-card">
            <span className="connect-emoji" aria-hidden="true">🤖</span>
            <h3>OpenAI</h3>
            <p className="muted small">API key from the OpenAI platform. Encrypted at rest.</p>
          </Link>
          {oauth.map((p) => (
            <a key={p.id} href={`/api/auth/${p.id}/start?returnTo=${encodeURIComponent(after)}`} className="connect-card">
              <span className="connect-emoji" aria-hidden="true">{p.vendor === 'mock' ? '🧪' : '🔗'}</span>
              <h3>{p.vendor === 'mock' ? 'Mock account' : p.label.replace(/^Continue with /, 'Link ')}</h3>
              <p className="muted small">{p.note ?? 'Links the account to your foodi login and uses it for recipes.'}</p>
            </a>
          ))}
        </div>
        <p className="hint">
          <Link to={after}>{me.vendor ? 'Back' : 'Skip for now'}</Link> — you can browse the feed and write recipes by hand without an AI connected.
        </p>
      </main>
    );
  }

  const c = COPY[vendor];
  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await auth.connectKey(vendor!, key.trim());
      nav(after, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 560 }}>
      <Wordmark />
      <div className="stack">
        <h1>{c.title}</h1>
        {provider.note && <p className="muted measure">{provider.note}</p>}
      </div>
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="key">API key</label>
          <input id="key" className="input input-lg" type="password" autoComplete="off" spellCheck={false} placeholder={`${c.prefix}…`} value={key} onChange={(e) => setKey(e.target.value)} required minLength={20} />
          <p className="hint">
            Create one at{' '}
            <a href={c.href} target="_blank" rel="noreferrer noopener">
              {c.where}
            </a>
            . It’s checked with one request, then encrypted at rest.
          </p>
        </div>
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
        <div className="row">
          <button className="btn btn-primary btn-lg" type="submit" disabled={busy || key.trim().length < 20}>
            {busy ? 'Checking key…' : 'Connect'}
          </button>
          <Link to="/connect" className="btn btn-quiet btn-lg">
            Back
          </Link>
        </div>
      </form>
    </main>
  );
}
