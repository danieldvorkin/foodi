import { Link, redirect, useLoaderData, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { auth, type AuthProviderInfo } from '../api/types';
import { HeroDemo } from '../components/HeroDemo';
import { Wordmark } from '../components/Logo';
import { maybeMe } from '../lib/session';
import '../styles/landing.css';

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
  const error = params.get('error');
  const oauth = data.providers.filter((p) => p.kind === 'oauth' && p.vendor !== 'mock');
  const mock = data.providers.find((p) => p.vendor === 'mock');
  const claude = data.providers.find((p) => p.vendor === 'anthropic');
  const hasOpenAiOAuth = oauth.some((p) => p.vendor === 'openai');
  const openaiKey = data.providers.find((p) => p.id === 'openai-key');

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
            {error && <div className="notice notice-warn">{error}</div>}
            {!data.allowSignups && <div className="notice">New sign-ups are paused. Existing accounts can still sign in.</div>}

            <div className="signin">
              {hasOpenAiOAuth ? (
                <a className="btn btn-lg btn-primary" href={`/api/auth/openai/start?returnTo=${encodeURIComponent(data.returnTo)}`}>
                  Continue with ChatGPT
                </a>
              ) : (
                openaiKey && (
                  <Link className="btn btn-lg btn-primary" to="/connect/openai">
                    Continue with OpenAI
                  </Link>
                )
              )}
              {claude && (
                <Link className="btn btn-lg" to="/connect/anthropic">
                  Continue with Claude
                </Link>
              )}
              {oauth
                .filter((p) => p.vendor !== 'openai')
                .map((p) => (
                  <a key={p.id} className="btn btn-lg" href={`/api/auth/${p.id}/start?returnTo=${encodeURIComponent(data.returnTo)}`}>
                    {p.label}
                  </a>
                ))}
            </div>
            <p className="hint measure">
              Your key or token is encrypted on this server and only used to write your recipes. Nothing is shared with anyone else.
              {mock && (
                <>
                  {' '}
                  <a href={`/api/auth/mock/start?returnTo=${encodeURIComponent(data.returnTo)}`}>Try it with a mock account</a> (development only).
                </>
              )}
            </p>
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
                <h3>Connect the AI you already pay for</h3>
                <p className="muted">Sign in with ChatGPT, or connect a Claude or OpenAI API key. foodi never bills you for generation — your account does the writing.</p>
              </div>
            </li>
            <li>
              <span className="how-n num">2</span>
              <div>
                <h3>Answer a few questions once</h3>
                <p className="muted">Diet, allergies, dislikes, skill, time, equipment. Every recipe is written against these — allergens are a hard rule, not a suggestion.</p>
              </div>
            </li>
            <li>
              <span className="how-n num">3</span>
              <div>
                <h3>Ask, drag, cook</h3>
                <p className="muted">Describe what you feel like or drag ingredients from the library. Then cook mode shows one step at a time with timers, big enough to read from across the counter.</p>
              </div>
            </li>
          </ol>
        </section>

        <section className="also">
          <div>
            <h3>Share what you make</h3>
            <p className="muted">Post a recipe you cooked (or wrote yourself), see what other people are making, save the ones you want to try.</p>
          </div>
          <div>
            <h3>Yours to run</h3>
            <p className="muted">One SQLite file, one Node process. Runs on your laptop; the admin panel is built in.</p>
          </div>
          <div>
            <h3>Honest about Claude</h3>
            <p className="muted">
              Anthropic doesn’t allow apps to sign you in with a Claude account, so “Continue with Claude” uses a Console API key. The OAuth layer is ready the day that changes.
            </p>
          </div>
        </section>
      </main>

      <footer className="landing-foot">
        <span className="muted small">foodi — guided recipes, your AI.</span>
      </footer>
    </div>
  );
}
