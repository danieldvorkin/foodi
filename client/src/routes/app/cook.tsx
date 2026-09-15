import { useEffect, useState } from 'react';
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { recipes as recipesApi } from '../../api/types';
import { Ring } from '../../components/HeroDemo';
import { ingredientLine, IngredientList } from '../../components/RecipeParts';
import { Sheet } from '../../components/ui';
import { clock } from '../../lib/format';
import { requireOnboarded } from '../../lib/session';
import { useTimer } from '../../lib/useTimer';
import '../../styles/cook.css';

export async function cookLoader({ request, params }: LoaderFunctionArgs) {
  await requireOnboarded(request);
  return recipesApi.get(params['id']!);
}

export function CookPage() {
  const { recipe } = useLoaderData<typeof cookLoader>();
  const c = recipe.content;
  const nav = useNavigate();
  const storageKey = `foodi.cook.${recipe.id}`;
  const [i, setI] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey));
      return Number.isFinite(saved) && saved >= 0 && saved < c.steps.length ? saved : 0;
    } catch {
      return 0;
    }
  });
  const [ingOpen, setIngOpen] = useState(false);
  const [done, setDone] = useState(false);
  const step = c.steps[i]!;
  const timer = useTimer(step.timerSeconds ?? 0, `${recipe.id}:${i}`);
  const last = i === c.steps.length - 1;

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, String(i));
    } catch {
      /* ignore */
    }
  }, [i, storageKey]);

  // Keep the screen on while cooking, where the browser allows it.
  useEffect(() => {
    let lock: { release: () => Promise<void> } | null = null;
    const nav2 = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    nav2.wakeLock?.request('screen').then((l) => (lock = l)).catch(() => {});
    return () => {
      lock?.release().catch(() => {});
    };
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (ingOpen) return;
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
      if (e.key === ' ' && step.timerSeconds) {
        e.preventDefault();
        timer.toggle();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  function next() {
    if (last) {
      setDone(true);
      try {
        localStorage.removeItem(storageKey);
      } catch {
        /* ignore */
      }
      return;
    }
    setI((x) => x + 1);
  }
  function prev() {
    setI((x) => Math.max(0, x - 1));
  }

  const need = step.ingredientRefs.map((r) => c.ingredients[r]).filter(Boolean);
  const total = step.timerSeconds ?? 0;
  const fraction = total ? 1 - timer.remaining / total : 0;

  if (done) {
    return (
      <main className="cook cook-done">
        <div className="cook-done-card">
          <h1>That’s it. Eat.</h1>
          <p className="muted">
            {c.title} — {c.steps.length} steps, done.
          </p>
          <div className="row" style={{ marginTop: 'var(--s-5)' }}>
            <Link to={`/app/recipes/${recipe.id}`} className="btn btn-primary btn-lg">
              Back to the recipe
            </Link>
            <Link to="/app/feed" className="btn btn-lg">
              Share how it went
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="cook">
      <div className="cook-progress" aria-hidden="true">
        <span style={{ width: `${((i + 1) / c.steps.length) * 100}%` }} />
      </div>
      <header className="cook-top">
        <button type="button" className="btn btn-quiet" onClick={() => nav(`/app/recipes/${recipe.id}`)}>
          ← {c.title}
        </button>
        <span className="num muted">
          Step {i + 1} of {c.steps.length}
        </span>
        <button type="button" className="btn btn-quiet" onClick={() => setIngOpen(true)}>
          Ingredients
        </button>
      </header>

      <section className="cook-step" key={i} aria-live="polite">
        <h1>{step.title}</h1>
        <p className="cook-text">{step.text}</p>
        {step.temperature && <p className="cook-temp">{step.temperature}</p>}

        {need.length > 0 && (
          <div className="cook-need">
            <span className="muted small">You need</span>
            <ul>
              {need.map((ing, k) => (
                <li key={k}>{ingredientLine(ing!)}</li>
              ))}
            </ul>
          </div>
        )}

        {total > 0 && (
          <div className={`cook-timer${timer.running ? ' is-running' : ''}${timer.done ? ' is-done' : ''}`}>
            <Ring fraction={fraction} size={64} stroke={4} />
            <div className="cook-timer-digits num">{timer.done ? 'Done' : clock(timer.remaining)}</div>
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <button type="button" className={`btn ${timer.running ? '' : 'btn-primary'}`} onClick={timer.toggle} disabled={timer.done}>
                {timer.running ? 'Pause' : timer.remaining < total ? 'Resume' : 'Start timer'}
              </button>
              {timer.remaining < total && (
                <button type="button" className="btn btn-quiet" onClick={timer.reset}>
                  Reset
                </button>
              )}
            </div>
          </div>
        )}

        {step.tip && <p className="cook-tip">{step.tip}</p>}
      </section>

      <footer className="cook-nav">
        <button type="button" className="btn btn-lg" onClick={prev} disabled={i === 0}>
          Back
        </button>
        <div className="cook-dots" aria-hidden="true">
          {c.steps.map((_, k) => (
            <button key={k} type="button" className={k === i ? 'is-on' : k < i ? 'is-done' : ''} onClick={() => setI(k)} tabIndex={-1} aria-label={`Go to step ${k + 1}`} />
          ))}
        </div>
        <button type="button" className="btn btn-primary btn-lg" onClick={next}>
          {last ? 'Finish' : 'Next step'}
        </button>
      </footer>

      <Sheet open={ingOpen} onClose={() => setIngOpen(false)} title="Ingredients">
        <IngredientList ingredients={c.ingredients} warnings={recipe.warnings} />
      </Sheet>
    </main>
  );
}
