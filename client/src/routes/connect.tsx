import { useState } from 'react';
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../api/client';
import { auth } from '../api/types';
import { KeyGuide } from '../components/KeyGuide';
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
  anthropic: { title: 'Connect Claude', prefix: 'sk-ant-' },
  openai: { title: 'Connect OpenAI', prefix: 'sk-' },
} as const;

export function Connect() {
  const { vendor, provider, me, providers } = useLoaderData<typeof connectLoader>();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [gettingManaged, setGettingManaged] = useState(false);
  const after = me.hasProfile ? '/app' : '/onboarding';

  async function useFoodisAi() {
    setGettingManaged(true);
    try {
      await auth.managedKey();
      nav(after, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setGettingManaged(false);
    }
  }


  if (!vendor || !provider) {
    const oauth = providers.filter((p) => p.kind === 'oauth');
    return (
      <main className="page-narrow stack-lg" style={{ maxWidth: 620 }}>
        <Wordmark />
        <div className="stack">
          <h1>🔌 Connect your AI</h1>
          <p className="muted measure">
            foodi writes recipes with an AI account you control — an OpenAI or Anthropic developer account with a few dollars of credit (about 2¢ a recipe). Nothing is billed by foodi. Pick one and we’ll walk you through it in four steps; swap or disconnect any time in Settings.
          </p>
        </div>
        {me.vendor && (
          <div className="notice notice-sage">
            Connected: <b>{me.vendor === 'anthropic' ? 'Claude' : me.vendor === 'openai' ? 'OpenAI' : 'mock account'}</b> ({me.credentialKind === 'oauth' ? 'linked account' : me.credentialKind === 'managed' ? 'provided by foodi' : 'API key'}).{' '}
            <Link to={after}>Continue →</Link>
          </div>
        )}
        {me.managedAvailable && (
          <div className="connect-managed">
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <h2>✨ Use foodi’s AI — no setup</h2>
              <p className="muted measure">One tap and you can cook. foodi gives you an OpenAI key of your own, with a daily allowance. Bring your own key any time for more.</p>
            </div>
            <button type="button" className="btn btn-primary btn-lg" onClick={useFoodisAi} disabled={gettingManaged}>
              {gettingManaged ? 'Setting up…' : 'Start cooking with foodi’s AI'}
            </button>
            {error && (
              <p className="error-text" role="alert">
                {error}
              </p>
            )}
            <p className="hint">Or connect your own account below.</p>
          </div>
        )}
        <div className="connect-grid">
          <Link to="/connect/openai" className="connect-card">
            <span className="connect-emoji" aria-hidden="true">🤖</span>
            <h3>OpenAI</h3>
            <p className="muted small">Recipes and photos. Account, $5 of credit, a key — we’ll show you each screen.</p>
          </Link>
          <Link to="/connect/anthropic" className="connect-card">
            <span className="connect-emoji" aria-hidden="true">🅰️</span>
            <h3>Claude</h3>
            <p className="muted small">Recipes and photo checks (library photos). Console account, $5 of credit, a key — same four steps.</p>
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
  async function connect() {
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
    <main className="page-narrow stack-lg" style={{ maxWidth: 720 }}>
      <Wordmark />
      <div className="stack">
        <h1>{c.title}</h1>
        <p className="muted measure">
          Four steps, about three minutes, and you only do it once. Your key stays encrypted on this server and pays only for what you cook — around 2¢ a recipe.
        </p>
      </div>
      <KeyGuide vendor={vendor} keyValue={key} onKeyChange={setKey} onSubmit={connect} busy={busy} error={error} prefix={c.prefix} />
      <p className="hint">
        <Link to="/connect">← Other ways to connect</Link> · <Link to={after}>Skip for now</Link> — the house kitchen’s recipes work without an AI.
      </p>
    </main>
  );
}
