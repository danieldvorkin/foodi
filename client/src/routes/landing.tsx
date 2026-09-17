import { useState, type FormEvent } from 'react';
import { redirect, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../api/client';
import { auth } from '../api/types';
import { HeroDemo } from '../components/HeroDemo';
import { Wordmark } from '../components/Logo';
import { maybeMe } from '../lib/session';

/** A taste of the house kitchen for people who aren't signed in: public recipes with a photo. */
interface Featured {
  total: number;
  recipes: { id: string; title: string; emoji: string; totalMinutes: number | null; cuisine: string | null; cover: string }[];
}

export async function landingLoader({ request }: LoaderFunctionArgs) {
  const me = await maybeMe();
  const url = new URL(request.url);
  // ?preview lets a signed-in person look at the front page (to check it before sharing).
  if (me && !url.searchParams.has('preview')) throw redirect(me.hasProfile ? '/app' : '/onboarding');
  const [providers, featured] = await Promise.all([
    auth.providers(),
    fetch('/share/featured.json')
      .then((r) => (r.ok ? (r.json() as Promise<Featured>) : null))
      .catch(() => null),
  ]);
  return { ...providers, featured, returnTo: url.searchParams.get('returnTo') ?? '/app' };
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
        <nav className="landing-nav" aria-label="Page">
          <a href="#see" className="navlink">
            See it
          </a>
          <a href="#how" className="navlink">
            How it works
          </a>
          <a href="#signin" className="navlink">
            Sign in
          </a>
        </nav>
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

            <div id="signin">
              <AuthForm allowSignups={data.allowSignups} returnTo={data.returnTo} />
            </div>

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

        <section id="see" className="showcase">
          <div className="showcase-head">
            <h2>What it looks like</h2>
            <p className="muted">Real screens, real recipes from the house kitchen.</p>
          </div>
          <div className="devices">
            <figure className="device device-phone">
              <img src="/marketing/cook-phone.jpg" width={768} height={1496} alt="Cook mode on a phone: one step in large type, the ingredients it needs, and a four-minute timer" loading="lazy" />
              <figcaption>
                <strong>Cook mode.</strong> One step at a time, readable from across the counter. Timers start when you tap them.
              </figcaption>
            </figure>
            <figure className="device device-desktop">
              <img src="/marketing/feed-desktop.jpg" width={1400} height={854} alt="The feed on a laptop: a composer, a shared recipe with its photo, people to follow and fresh blog posts" loading="lazy" />
              <figcaption>
                <strong>The feed.</strong> What people are cooking, recipe books for sale, blog posts, a shop — and everything you’ve made, one click away.
              </figcaption>
            </figure>
            <figure className="device device-phone">
              <img src="/marketing/recipe-phone.jpg" width={768} height={1496} alt="A recipe page on a phone: a golden turmeric latte with its summary, timings, and diet tags" loading="lazy" />
              <figcaption>
                <strong>Every recipe gets a photo.</strong> Generated by your AI, or found and checked for you. Swap it until it’s right.
              </figcaption>
            </figure>
          </div>
        </section>

        {data.featured && data.featured.recipes.length > 0 && (
          <section className="kitchen" aria-labelledby="kitchen-h">
            <div className="showcase-head">
              <h2 id="kitchen-h">{data.featured.total} recipes waiting the moment you sign up</h2>
              <p className="muted">The house kitchen covers vegan, gluten-free, nut-free, halal, kosher and more — no AI account needed to start cooking.</p>
            </div>
            <ul className="kitchen-grid">
              {data.featured.recipes.map((r) => (
                <li key={r.id} className="kitchen-tile">
                  <img src={r.cover} alt="" loading="lazy" />
                  <span className="kitchen-tile-label">
                    <span aria-hidden="true">{r.emoji}</span> {r.title}
                    {r.totalMinutes ? <small> · {r.totalMinutes} min</small> : null}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

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
                <p className="muted">An OpenAI or Anthropic developer account with $5 of credit — about 2¢ a recipe, and we walk you through it screen by screen. foodi never bills you; your account does the writing. Or skip it and cook from the house kitchen.</p>
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
        <nav className="landing-foot-links" aria-label="More">
          <a href="https://github.com/danieldvorkin/foodi" className="muted small" target="_blank" rel="noopener noreferrer">
            GitHub
          </a>
          <a href="#how" className="muted small">
            How it works
          </a>
          <a href="#signin" className="muted small">
            Sign in
          </a>
        </nav>
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
