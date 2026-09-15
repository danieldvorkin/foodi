import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { recipes as recipesApi, social as socialApi } from '../../api/types';
import { IngredientList, StepList } from '../../components/RecipeParts';
import { useToast } from '../../components/Toast';
import { Meta, Sheet } from '../../components/ui';
import { minutes, servingsLabel } from '../../lib/format';
import '../../styles/recipe.css';

export async function recipeLoader({ params }: LoaderFunctionArgs) {
  return recipesApi.get(params['id']!);
}

export function RecipePage() {
  const data = useLoaderData<typeof recipeLoader>();
  const { recipe, isMine, source, visibility, author } = data;
  const c = recipe.content;
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [tweak, setTweak] = useState('');
  const [tweakOpen, setTweakOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);

  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  async function doTweak() {
    if (!tweak.trim()) return;
    setBusy(true);
    try {
      const { recipe: next } = await recipesApi.generate({ prompt: tweak.trim(), ingredientIds: [], basedOnRecipeId: recipe.id });
      setTweakOpen(false);
      nav(`/app/recipes/${next.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function share() {
    setBusy(true);
    try {
      await socialApi.createPost(recipe.id, caption.trim());
      setShareOpen(false);
      toast('Shared to the feed');
      nav('/app/feed');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    try {
      const { id } = await recipesApi.save(recipe.id);
      toast('Saved to your recipes');
      nav(`/app/recipes/${id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!window.confirm('Delete this recipe? This can’t be undone.')) return;
    try {
      await recipesApi.remove(recipe.id);
      nav('/app');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="page recipe">
      <header className="recipe-head">
        <div className="stack">
          {author && !isMine && (
            <p className="muted small">
              By{' '}
              <Link to={`/app/u/${author.handle}`}>
                {author.displayName}
              </Link>
            </p>
          )}
          <h1>{c.title}</h1>
          <p className="lede-sm measure">{c.summary}</p>
          <Meta
            items={[
              { value: minutes(c.totalMinutes), label: 'total' },
              { value: minutes(c.activeMinutes), label: 'hands-on' },
              servingsLabel(c.servings),
              c.difficulty,
              ...(c.cuisine ? [c.cuisine] : []),
            ]}
          />
          {(c.dietLabels.length > 0 || c.tags.length > 0) && (
            <div className="badges">
              {c.dietLabels.map((d) => (
                <span key={d} className="chip chip-static chip-sage">
                  {d}
                </span>
              ))}
              {c.tags.map((t) => (
                <span key={t} className="chip chip-static">
                  {t}
                </span>
              ))}
            </div>
          )}
          {recipe.warnings.length > 0 && (
            <div className="notice notice-warn" role="alert">
              Contains {recipe.warnings.join(', ')} — which you told us you can’t eat. Check the ingredients before cooking.
            </div>
          )}
        </div>
        <div className="recipe-actions">
          <Link to={`/cook/${recipe.id}`} className="btn btn-primary btn-lg">
            Start cooking
          </Link>
          {isMine ? (
            <>
              <button type="button" className="btn" onClick={() => setTweakOpen(true)}>
                Adjust
              </button>
              <button type="button" className="btn" onClick={() => setShareOpen(true)}>
                {visibility === 'public' ? 'Share again' : 'Share'}
              </button>
              {source === 'user' && (
                <Link to={`/app/recipes/${recipe.id}/edit`} className="btn">
                  Edit
                </Link>
              )}
              <button
                type="button"
                className="btn btn-quiet"
                aria-pressed={recipe.favorite}
                onClick={async () => {
                  await recipesApi.favorite(recipe.id, !recipe.favorite);
                  revalidate();
                }}
              >
                {recipe.favorite ? '★ Favorite' : '☆ Favorite'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={remove}>
                Delete
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={save}>
              Save to my recipes
            </button>
          )}
        </div>
      </header>

      <div className="recipe-body">
        <section className="recipe-ings">
          <div className="section-head">
            <h2>Ingredients</h2>
            {checked.size > 0 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setChecked(new Set())}>
                Uncheck all
              </button>
            )}
          </div>
          <IngredientList ingredients={c.ingredients} checked={checked} onToggle={toggle} warnings={recipe.warnings} />
          {c.equipment.length > 0 && (
            <div className="stack" style={{ marginTop: 'var(--s-5)', gap: 'var(--s-2)' }}>
              <h4>You’ll need</h4>
              <p className="muted small">{c.equipment.join(', ')}</p>
            </div>
          )}
          {c.substitutions.length > 0 && (
            <div className="stack" style={{ marginTop: 'var(--s-5)', gap: 'var(--s-2)' }}>
              <h4>Swaps</h4>
              <ul className="small muted stack" style={{ gap: 4 }}>
                {c.substitutions.map((s, i) => (
                  <li key={i}>
                    <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{s.ingredient}</b> → {s.swap}
                    {s.why ? ` (${s.why})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="recipe-steps">
          <div className="section-head">
            <h2>Steps</h2>
            <span className="muted small">{c.steps.length} steps</span>
          </div>
          <StepList steps={c.steps} ingredients={c.ingredients} />
          {(c.makeAhead || c.storage || c.nutritionPerServing) && (
            <div className="recipe-notes">
              {c.makeAhead && (
                <p>
                  <b>Make ahead.</b> {c.makeAhead}
                </p>
              )}
              {c.storage && (
                <p>
                  <b>Leftovers.</b> {c.storage}
                </p>
              )}
              {c.nutritionPerServing && (
                <p className="muted small">
                  Per serving, roughly: {Math.round(c.nutritionPerServing.calories)} kcal · {Math.round(c.nutritionPerServing.proteinGrams)} g protein ·{' '}
                  {Math.round(c.nutritionPerServing.carbsGrams)} g carbs · {Math.round(c.nutritionPerServing.fatGrams)} g fat
                </p>
              )}
            </div>
          )}
          {recipe.prompt && (
            <p className="muted small" style={{ marginTop: 'var(--s-5)' }}>
              Written from: “{recipe.prompt}” · {recipe.provider === 'mock' ? 'mock chef' : recipe.model}
            </p>
          )}
        </section>
      </div>

      <Sheet open={tweakOpen} onClose={() => setTweakOpen(false)} title="Adjust this recipe">
        <p className="muted small">Say what to change. You’ll get a new version; this one stays.</p>
        <div className="chips">
          {['Make it vegan', 'Halve it', 'Double it', 'Less spicy', 'Faster', 'Swap the protein'].map((t) => (
            <button key={t} type="button" className="chip" onClick={() => setTweak(t)}>
              {t}
            </button>
          ))}
        </div>
        <textarea className="textarea" value={tweak} onChange={(e) => setTweak(e.target.value)} placeholder="e.g. no oven — stovetop only" maxLength={500} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={doTweak} disabled={busy || !tweak.trim()}>
            {busy ? 'Rewriting…' : 'Rewrite'}
          </button>
        </div>
      </Sheet>

      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="Share to the feed">
        <p className="muted small">Everyone signed in to this foodi can see it and save it. You can take it down any time.</p>
        <textarea className="textarea" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go? Anything you changed?" maxLength={1000} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy}>
            {busy ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </Sheet>
    </main>
  );
}
