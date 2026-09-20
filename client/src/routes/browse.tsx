import { useState, type FormEvent } from 'react';
import { Link, redirect, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { DIET_LABELS, MEAL_EMOJI, MEAL_TYPES, TIME_FILTERS, type BrowseQuery, type BrowseRecipe, type Me } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { browse as browseApi } from '../api/types';
import { Wordmark } from '../components/Logo';
import { IngredientList } from '../components/RecipeParts';
import { useToast } from '../components/Toast';
import { Sheet } from '../components/ui';
import { minutes, servingsLabel } from '../lib/format';
import { maybeMe } from '../lib/session';
import { useDerivedState } from '../lib/useDerivedState';

function queryFrom(url: URL): BrowseQuery {
  const p = url.searchParams;
  const meal = p.get('meal');
  const diet = p.get('diet');
  const difficulty = p.get('difficulty');
  const max = Number(p.get('max'));
  return {
    q: p.get('q') ?? '',
    limit: 24,
    ...(MEAL_TYPES.includes(meal as never) ? { meal: meal as BrowseQuery['meal'] } : {}),
    ...(DIET_LABELS.includes(diet as never) ? { diet: diet as BrowseQuery['diet'] } : {}),
    ...(difficulty === 'easy' || difficulty === 'medium' || difficulty === 'hard' ? { difficulty } : {}),
    ...(max > 0 ? { maxMinutes: max } : {}),
  };
}

export async function browseLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const query = queryFrom(url);
  const [me, page] = await Promise.all([maybeMe(), browseApi.list(query)]);
  return { me, query, ...page };
}

export async function browseRecipeLoader({ params }: LoaderFunctionArgs) {
  const me = await maybeMe();
  // People with an account get the real thing.
  if (me?.hasProfile) throw redirect(`/app/recipes/${params['id']}`);
  const { recipe } = await browseApi.get(params['id']!);
  return { me, recipe };
}

/** The bar visitors see: wordmark, and the two doors in. */
function VisitorTop({ me, returnTo }: { me: Me | null; returnTo: string }) {
  return (
    <header className="browse-top">
      <Wordmark to={me ? '/app' : '/'} />
      <nav className="browse-top-nav" aria-label="Account">
        {me ? (
          <Link to="/app" className="btn btn-sm">
            Back to the app
          </Link>
        ) : (
          <>
            <Link to={`/?returnTo=${encodeURIComponent(returnTo)}#signin`} className="navlink">
              Sign in
            </Link>
            <Link to={`/?returnTo=${encodeURIComponent(returnTo)}#signin`} className="btn btn-primary btn-sm">
              Create a free account
            </Link>
          </>
        )}
      </nav>
    </header>
  );
}

export function BrowsePage() {
  const data = useLoaderData<typeof browseLoader>();
  const [params, setParams] = useSearchParams();
  const toast = useToast();
  const [draft, setDraft] = useState(data.query.q);
  const [paged, setPaged] = useDerivedState(data, (d) => ({ more: [] as BrowseRecipe[], nextCursor: d.nextCursor, loading: false }));
  const recipes = [...data.recipes, ...paged.more];
  const active = Boolean(data.query.meal || data.query.diet || data.query.difficulty || data.query.maxMinutes || data.query.q);

  function set(key: string, value: string | null) {
    const next = new URLSearchParams(params);
    if (value === null || params.get(key) === value) next.delete(key);
    else next.set(key, value);
    setParams(next);
  }
  function search(e: FormEvent) {
    e.preventDefault();
    set('q', draft.trim() || null);
  }
  async function loadMore() {
    if (!paged.nextCursor || paged.loading) return;
    setPaged((p) => ({ ...p, loading: true }));
    try {
      const r = await browseApi.list({ ...data.query, cursor: paged.nextCursor });
      setPaged((p) => ({ more: [...p.more, ...r.recipes], nextCursor: r.nextCursor, loading: false }));
    } catch (e) {
      toast(errorMessage(e), 'error');
      setPaged((p) => ({ ...p, loading: false }));
    }
  }
  const to = (r: BrowseRecipe) => (data.me?.hasProfile ? `/app/recipes/${r.id}` : `/browse/${r.id}`);

  return (
    <div className="browse">
      <VisitorTop me={data.me} returnTo="/browse" />
      <main className="browse-main">
        <section className="browse-hero">
          <h1>What are you cooking tonight?</h1>
          <p className="muted">Recipes from the foodi kitchen and its cooks — every one has a photo, timings and diet labels. No account needed to look.</p>
          <form className="browse-search" onSubmit={search} role="search">
            <label htmlFor="browse-q" className="sr-only">
              Search recipes
            </label>
            <input id="browse-q" className="input input-lg" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Try “chickpea”, “noodles”, “vegan dinner”" enterKeyHint="search" />
            <button type="submit" className="btn btn-primary btn-lg">
              Search
            </button>
          </form>
        </section>

        <section className="browse-filters" aria-label="Filters">
          <div className="chips" role="group" aria-label="Meal">
            {MEAL_TYPES.map((m) => (
              <button key={m} type="button" className="chip" aria-pressed={data.query.meal === m} onClick={() => set('meal', m)}>
                {MEAL_EMOJI[m]} {m}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Diet">
            {DIET_LABELS.map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={data.query.diet === d} onClick={() => set('diet', d)}>
                {d}
              </button>
            ))}
          </div>
          <div className="chips" role="group" aria-label="Time and effort">
            {TIME_FILTERS.map((t) => (
              <button key={t} type="button" className="chip" aria-pressed={data.query.maxMinutes === t} onClick={() => set('max', String(t))}>
                ⏱ under {t} min
              </button>
            ))}
            {(['easy', 'medium', 'hard'] as const).map((d) => (
              <button key={d} type="button" className="chip" aria-pressed={data.query.difficulty === d} onClick={() => set('difficulty', d)}>
                {d}
              </button>
            ))}
            {active && (
              <button type="button" className="chip chip-quiet" onClick={() => setParams({})}>
                × Clear
              </button>
            )}
          </div>
        </section>

        {recipes.length === 0 ? (
          <p className="browse-empty muted">Nothing matches that yet. Try fewer filters, or a different word.</p>
        ) : (
          <ul className="browse-grid">
            {recipes.map((r) => (
              <li key={r.id}>
                <Link to={to(r)} className="browse-tile">
                  {r.cover ? (
                    <img src={r.cover} alt="" loading="lazy" />
                  ) : (
                    <span className="browse-tile-emoji" aria-hidden="true">
                      {r.emoji}
                    </span>
                  )}
                  <span className="browse-tile-body">
                    <span className="browse-tile-title">
                      <span aria-hidden="true">{r.emoji}</span> {r.title}
                    </span>
                    <span className="muted small num">
                      {minutes(r.totalMinutes)} · {r.difficulty}
                      {r.dietLabels.slice(0, 2).map((d) => ` · ${d}`)}
                    </span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
        {paged.nextCursor && (
          <div className="row" style={{ justifyContent: 'center' }}>
            <button type="button" className="btn" onClick={loadMore} disabled={paged.loading}>
              {paged.loading ? 'Loading…' : 'More recipes'}
            </button>
          </div>
        )}
      </main>
      <footer className="browse-foot muted small">
        <Link to="/">foodi</Link> — guided recipes, your AI. {data.me ? '' : 'Create a free account to cook these step by step.'}
      </footer>
    </div>
  );
}

/** A public recipe: everything but the method, and one clear invitation. */
export function BrowseRecipePage() {
  const { me, recipe } = useLoaderData<typeof browseRecipeLoader>();
  const nav = useNavigate();
  const [join, setJoin] = useState<string | null>(null);
  const returnTo = `/app/recipes/${recipe.id}`;
  const cover = recipe.media[0] ?? null;
  const ask = (why: string) => setJoin(why);

  return (
    <div className="browse">
      <VisitorTop me={me} returnTo={returnTo} />
      <main className="browse-main browse-recipe">
        <Link to="/browse" className="muted small">
          ← All recipes
        </Link>
        {cover && (
          <figure className="browse-cover">
            <img src={cover.url} alt="" width={cover.width ?? undefined} height={cover.height ?? undefined} />
            {cover.generated && cover.source !== 'ai' && cover.credit && (
              <figcaption className="hint">
                📷 {cover.sourceUrl ? <a href={cover.sourceUrl} target="_blank" rel="noopener noreferrer">{`Photo: ${cover.credit}${cover.license ? ` · ${cover.license}` : ''}`}</a> : `Photo: ${cover.credit}`}
              </figcaption>
            )}
          </figure>
        )}
        <header className="stack">
          <p className="muted small">
            {recipe.author.avatar} By {recipe.author.displayName}
          </p>
          <h1>
            <span aria-hidden="true">{recipe.emoji}</span> {recipe.title}
          </h1>
          <p className="lede">{recipe.summary}</p>
          <p className="muted small num">
            ⏱ {minutes(recipe.totalMinutes)} total · {minutes(recipe.activeMinutes)} hands-on · 👥 {servingsLabel(recipe.servings)} · {recipe.difficulty}
            {recipe.cuisine ? ` · ${recipe.cuisine}` : ''}
          </p>
          {recipe.dietLabels.length > 0 && (
            <p className="badges">
              {recipe.dietLabels.map((d) => (
                <span key={d} className="chip chip-static">
                  {d}
                </span>
              ))}
            </p>
          )}
        </header>
        <div className="browse-actions">
          <button type="button" className="btn btn-primary" onClick={() => ask('cook this step by step, with timers')}>
            🧑‍🍳 Cook this
          </button>
          <button type="button" className="btn" onClick={() => ask('save it to your recipes')}>
            ⭐ Save
          </button>
          <button type="button" className="btn" onClick={() => ask('put its ingredients on a shopping list')}>
            🛒 Shopping list
          </button>
        </div>
        <div className="browse-columns">
          <section className="stack">
            <h2>🧺 Ingredients</h2>
            <IngredientList ingredients={recipe.ingredients} />
          </section>
          <section className="stack">
            <h2>👣 Steps</h2>
            <ol className="browse-steps">
              {recipe.stepTitles.map((t, i) => (
                <li key={i}>
                  <span className="num">{i + 1}</span> {t}
                </li>
              ))}
            </ol>
            <div className="browse-wall">
              <p>
                <b>The method is for members.</b> Create a free account and foodi walks you through {recipe.stepCount} steps one at a time, with timers, a shopping list, and recipes written for your own diet.
              </p>
              <div className="row">
                <Link to={`/?returnTo=${encodeURIComponent(returnTo)}#signin`} className="btn btn-primary">
                  Create a free account
                </Link>
                <Link to={`/?returnTo=${encodeURIComponent(returnTo)}#signin`} className="btn">
                  Sign in
                </Link>
              </div>
            </div>
          </section>
        </div>
      </main>
      <Sheet open={join !== null} onClose={() => setJoin(null)} title="Join foodi — it’s free">
        <div className="stack">
          <p>
            To {join}, you need an account. It takes a minute, and you’ll land right back on <b>{recipe.title}</b>.
          </p>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={() => nav(`/?returnTo=${encodeURIComponent(returnTo)}#signin`)}>
              Create a free account
            </button>
            <button type="button" className="btn" onClick={() => nav(`/?returnTo=${encodeURIComponent(returnTo)}#signin`)}>
              Sign in
            </button>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
