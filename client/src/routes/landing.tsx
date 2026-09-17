import { useState, type FormEvent } from 'react';
import { redirect, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../api/client';
import { auth } from '../api/types';
import { HeroDemo } from '../components/HeroDemo';
import { Wordmark } from '../components/Logo';
import { maybeMe } from '../lib/session';

export async function landingLoader({ request }: LoaderFunctionArgs) {
  const me = await maybeMe();
  if (me) throw redirect(me.hasProfile ? '/app' : '/onboarding');
  const url = new URL(request.url);
  const providers = await auth.providers();
  return { ...providers, returnTo: url.searchParams.get('returnTo') ?? '/app' };
}

export function Landing() {
  const data = useLoaderData<typeof landingLoader>();
  const [params] = useSearchParams();
  const oauthError = params.get('error');
  const sso = data.providers.filter((p) => p.kind === 'oauth');
  const mock = sso.find((p) => p.vendor === 'mock');
  const real = sso.filter((p) => p.vendor !== 'mock');

  return (
    <div className="landing">
      <header className="landing-top">
        <Wordmark />
        <a href="#how" className="navlink">
          How it works
        </a>
      </header>

      <main>
        <section className="hero">
          <div className="hero-copy">
            <h1>
              Cook something tonight.
              <br />
              We’ll walk you through it.
            </h1>
            <p className="lede">
              foodi writes recipes around your answers — allergies, skill, time, what’s in the kitchen — then guides you one step at a time with timers that
              start when you tap them. It runs on the AI account you already have.
            </p>

            {data.maintenanceMessage && <div className="notice notice-warn">{data.maintenanceMessage}</div>}
            {oauthError && <div className="notice notice-warn">{oauthError}</div>}

            <AuthForm allowSignups={data.allowSignups} returnTo={data.returnTo} />

            {(real.length > 0 || mock) && (
              <div className="sso">
                <span className="hint">or continue with</span>
                <div className="row">
                  {real.map((p) => (
                    <a key={p.id} className="btn" href={`/api/auth/${p.id}/start?returnTo=${encodeURIComponent(data.returnTo)}`}>
                      {p.label.replace(/^Continue with /, '')}
                    </a>
                  ))}
                  {mock && (
                    <>
                      <a className="btn" href={`/api/auth/mock/start?login_hint=mock-ada&returnTo=${encodeURIComponent(data.returnTo)}`}>
                        🧪 Mock admin
                      </a>
                      <a className="btn" href={`/api/auth/mock/start?login_hint=mock-sam&returnTo=${encodeURIComponent(data.returnTo)}`}>
                        🧪 Mock user
                      </a>
                      <a className="btn btn-quiet" href={`/api/auth/mock/start?returnTo=${encodeURIComponent(data.returnTo)}`}>
                        Other mock people…
                      </a>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="hero-visual">
            <HeroDemo />
          </div>
        </section>

        <section id="how" className="how">
          <h2>How it works</h2>
          <ol className="how-steps">
            <li>
              <span className="how-n num">1</span>
              <div>
                <h3>📝 Create an account, answer a few questions</h3>
                <p className="muted">Diet, allergies, dislikes, skill, time, equipment. Every recipe is written against these — allergens are a hard rule, not a suggestion.</p>
              </div>
            </li>
            <li>
              <span className="how-n num">2</span>
              <div>
                <h3>🔌 Connect the AI you already pay for</h3>
                <p className="muted">Paste a Claude or OpenAI API key, or link your ChatGPT account. foodi never bills you for generation — your account does the writing. Swap it any time.</p>
              </div>
            </li>
            <li>
              <span className="how-n num">3</span>
              <div>
                <h3>🧺 Ask, drag, cook</h3>
                <p className="muted">Describe what you feel like or drag ingredients from the library. Then cook mode shows one step at a time with timers, big enough to read from across the counter.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="also">
          <div>
            <h3>📷 Share what you make</h3>
            <p className="muted">Post photos and videos of what you cooked (or a recipe you wrote yourself), see what other people are making, save the ones you want to try.</p>
          </div>
          <div>
            <h3>💻 Yours to run</h3>
            <p className="muted">One SQLite file, one Node process, on your own machine. Keys are encrypted at rest; the admin panel is built in.</p>
          </div>
          <div>
            <h3>🤝 Honest about Claude</h3>
            <p className="muted">Anthropic doesn’t allow apps to sign you in with a Claude account, so Claude connects with a Console API key. The OAuth layer is ready the day that changes.</p>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span className="muted small">foodi — guided recipes, your AI.</span>
      </footer>
    </div>
  );
}

function AuthForm({ allowSignups, returnTo }: { allowSignups: boolean; returnTo: string }) {
  const nav = useNavigate();
  const [mode, setMode] = useState<'in' | 'up'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const me = mode === 'in' ? await auth.login(email, password) : await auth.register(email, password, name);
      const safe = returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/app';
      nav(me.hasProfile ? safe : '/onboarding', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  }

  return (
    <form className="authform" onSubmit={submit}>
      <div className="chips" role="tablist">
        <button type="button" role="tab" className="chip" aria-selected={mode === 'in'} onClick={() => setMode('in')}>
          Sign in
        </button>
        {allowSignups && (
          <button type="button" role="tab" className="chip" aria-selected={mode === 'up'} onClick={() => setMode('up')}>
            Create account
          </button>
        )}
      </div>
      {mode === 'up' && (
        <div className="field">
          <label htmlFor="name">Name</label>
          <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" maxLength={40} required placeholder="What should we call you?" />
        </div>
      )}
      <div className="field">
        <label htmlFor="email">Email</label>
        <input id="email" className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required placeholder="you@example.com" />
      </div>
      <div className="field">
        <label htmlFor="password">Password</label>
        <input
          id="password"
          className="input"
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === 'in' ? 'current-password' : 'new-password'}
          minLength={mode === 'up' ? 10 : 1}
          maxLength={200}
          required
          placeholder={mode === 'up' ? 'At least 10 characters' : ''}
        />
      </div>
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      <button className="btn btn-primary btn-lg" type="submit" disabled={busy}>
        {busy ? 'One moment…' : mode === 'in' ? 'Sign in' : 'Create account'}
      </button>
      <p className="hint">
        {mode === 'in' ? 'Your AI key is connected after you sign in, from Settings — never used to log in.' : 'Stored on this server only. You’ll connect an AI account next.'}
      </p>
    </form>
  );
}
