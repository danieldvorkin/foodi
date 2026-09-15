import { useState, type FormEvent } from 'react';
import { Link, redirect, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../api/client';
import { auth } from '../api/types';
import { Wordmark } from '../components/Logo';
import { maybeMe } from '../lib/session';

export async function connectLoader({ params }: LoaderFunctionArgs) {
  const raw = params['vendor'];
  if (raw !== 'openai' && raw !== 'anthropic') throw redirect('/');
  const vendor: 'openai' | 'anthropic' = raw;
  const [me, { providers }] = await Promise.all([maybeMe(), auth.providers()]);
  const provider = providers.find((p) => p.kind === 'api_key' && p.vendor === vendor);
  if (!provider) throw redirect('/');
  return { vendor, provider, me };
}

const COPY = {
  anthropic: {
    title: 'Continue with Claude',
    where: 'console.anthropic.com → API keys',
    href: 'https://console.anthropic.com/settings/keys',
    prefix: 'sk-ant-',
  },
  openai: {
    title: 'Continue with OpenAI',
    where: 'platform.openai.com → API keys',
    href: 'https://platform.openai.com/api-keys',
    prefix: 'sk-',
  },
} as const;

export function Connect() {
  const { vendor, provider, me } = useLoaderData<typeof connectLoader>();
  const nav = useNavigate();
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = COPY[vendor];

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const result = await auth.connectKey(vendor, key.trim());
      nav(me ? '/app/settings' : result.hasProfile ? '/app' : '/onboarding', { replace: true });
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
        <h1>{me ? `Connect ${vendor === 'anthropic' ? 'Claude' : 'OpenAI'}` : c.title}</h1>
        {provider.note && <p className="muted measure">{provider.note}</p>}
      </div>
      <form onSubmit={submit} className="stack">
        <div className="field">
          <label htmlFor="key">API key</label>
          <input
            id="key"
            className="input input-lg"
            type="password"
            autoComplete="off"
            spellCheck={false}
            placeholder={`${c.prefix}…`}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            required
            minLength={20}
          />
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
            {busy ? 'Checking key…' : me ? 'Connect key' : 'Continue'}
          </button>
          <Link to={me ? '/app/settings' : '/'} className="btn btn-quiet btn-lg">
            Back
          </Link>
        </div>
      </form>
    </main>
  );
}
