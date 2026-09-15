import { useEffect, useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator } from 'react-router';
import { MEAL_TYPES } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { profile as profileApi, recipes as recipesApi } from '../../api/types';
import { IngredientPicker } from '../../components/IngredientPicker';
import { useToast } from '../../components/Toast';
import { Empty, Meta } from '../../components/ui';
import { minutes, servingsLabel, timeAgo } from '../../lib/format';
import { useMe } from './layout';
import '../../styles/home.css';

export async function homeLoader() {
  const [list, pantry, prof] = await Promise.all([recipesApi.list(), profileApi.pantry(), profileApi.get()]);
  return { recipes: list.recipes, pantry: pantry.ingredientIds, profile: prof.profile };
}

const COOKING_LINES = ['Reading your answers…', 'Checking allergens twice…', 'Writing the steps…', 'Setting the timers…', 'Plating up…'];

const QUICK = [
  { label: 'Quick weeknight', prompt: 'Something quick for a weeknight, minimal cleanup.' },
  { label: 'High protein', prompt: 'High-protein dinner that still feels like a treat.' },
  { label: 'Big batch', prompt: 'A big batch I can eat for a few days.' },
  { label: 'Comfort food', prompt: 'Warm, comforting, a bit indulgent.' },
  { label: 'Surprise me', prompt: 'Surprise me with something I probably haven’t made before.' },
];

export function Home() {
  const { recipes, pantry, profile } = useLoaderData<typeof homeLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [prompt, setPrompt] = useState('');
  const [basket, setBasket] = useState<string[]>([]);
  const [mealType, setMealType] = useState<string>('');
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);

  useEffect(() => {
    if (!busy) return;
    setLine(0);
    const t = window.setInterval(() => setLine((l) => Math.min(COOKING_LINES.length - 1, l + 1)), 1400);
    return () => window.clearInterval(t);
  }, [busy]);

  const canGenerate = prompt.trim().length > 1 || basket.length > 0;

  async function generate() {
    if (!canGenerate || busy) return;
    setBusy(true);
    try {
      const { recipe } = await recipesApi.generate({ prompt: prompt.trim(), ingredientIds: basket, ...(mealType ? { mealType } : {}) });
      nav(`/app/recipes/${recipe.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  async function savePantry() {
    try {
      await profileApi.savePantry(basket);
      toast('Saved as your pantry');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const firstName = (profile?.displayName ?? me.displayName ?? '').split(' ')[0];

  return (
    <main className="page stack-lg home">
      <section className="stack">
        <h1>{firstName ? `What are we cooking, ${firstName}?` : 'What are we cooking?'}</h1>
        <div className="ask">
          <textarea
            className="textarea ask-input"
            placeholder="Describe what you feel like — “something with the salmon in the fridge, under 30 minutes”"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            maxLength={500}
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
            }}
          />
          <div className="row-between">
            <div className="chips">
              {QUICK.map((q) => (
                <button key={q.label} type="button" className="chip" onClick={() => setPrompt(q.prompt)}>
                  {q.label}
                </button>
              ))}
            </div>
            <select className="select" style={{ width: 'auto', minHeight: 36, padding: '6px 10px' }} value={mealType} onChange={(e) => setMealType(e.target.value)} aria-label="Meal type">
              <option value="">Any meal</option>
              {MEAL_TYPES.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </div>
        </div>
      </section>

      <section>
        <IngredientPicker
          selected={basket}
          onChange={setBasket}
          pantry={pantry}
          basketHint="The recipe must use everything in here. Leave it empty to let the request decide."
          basketFooter={
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <button type="button" className="btn btn-primary btn-lg btn-block" onClick={generate} disabled={!canGenerate || busy}>
                {busy ? (
                  <>
                    <span className="spinner" style={{ borderTopColor: 'var(--sage-ink)', borderColor: 'color-mix(in oklab, var(--sage-ink) 35%, transparent)' }} /> {COOKING_LINES[line]}
                  </>
                ) : (
                  'Write my recipe'
                )}
              </button>
              {basket.length > 0 && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={savePantry}>
                  Save these as my pantry
                </button>
              )}
              <p className="hint" style={{ textAlign: 'center' }}>
                Written by {me.vendor === 'anthropic' ? 'Claude' : me.vendor === 'openai' ? 'OpenAI' : 'the mock chef'} with your account.
              </p>
            </div>
          }
        />
      </section>

      <section>
        <div className="section-head">
          <h2>Your recipes</h2>
          <Link to="/app/recipes/new" className="btn btn-sm">
            Write one by hand
          </Link>
        </div>
        {recipes.length === 0 ? (
          <Empty title="Nothing here yet">Your first recipe shows up here the moment it’s written.</Empty>
        ) : (
          <ul className="rlist">
            {recipes.map((r) => (
              <li key={r.id} className="rlist-item">
                <div className="stack" style={{ gap: 6 }}>
                  <h3>
                    <Link to={`/app/recipes/${r.id}`}>
                      {r.favorite && <span aria-label="Favorite">★ </span>}
                      {r.title}
                    </Link>
                  </h3>
                  <p className="muted small">{r.summary}</p>
                  <Meta items={[minutes(r.totalMinutes), servingsLabel(r.servings), r.difficulty, ...(r.warnings.length ? [`⚠ ${r.warnings.join(', ')}`] : [])]} />
                </div>
                <span className="when">{timeAgo(r.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
