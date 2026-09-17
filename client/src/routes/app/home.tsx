import { useEffect, useRef, useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator } from 'react-router';
import { getIngredient, MEAL_EMOJI, MEAL_TYPES } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { media as mediaApi, profile as profileApi, recipes as recipesApi } from '../../api/types';
import { IngredientPicker } from '../../components/IngredientPicker';
import { useToast } from '../../components/Toast';
import { Empty, Meta } from '../../components/ui';
import { minutes, servingsLabel, timeAgo } from '../../lib/format';
import { useMe } from './layout';

export async function homeLoader() {
  const [list, pantry, prof] = await Promise.all([recipesApi.list(), profileApi.pantry(), profileApi.get()]);
  return { recipes: list.recipes, pantry: pantry.ingredientIds, profile: prof.profile };
}

const COOKING_LINES = ['Reading your answers…', 'Checking allergens twice…', 'Writing the steps…', 'Setting the timers…', 'Plating up…'];

const QUICK = [
  { emoji: '⚡', label: 'Quick weeknight', prompt: 'Something quick for a weeknight, minimal cleanup.' },
  { emoji: '💪', label: 'High protein', prompt: 'High-protein dinner that still feels like a treat.' },
  { emoji: '🍲', label: 'Big batch', prompt: 'A big batch I can eat for a few days.' },
  { emoji: '🧸', label: 'Comfort food', prompt: 'Warm, comforting, a bit indulgent.' },
  { emoji: '🎲', label: 'Surprise me', prompt: 'Surprise me with something I probably haven’t made before.' },
];

interface Draft {
  prompt: string;
  basket: string[];
  mealType: string;
}
const DRAFT_KEY = 'foodi.cook.draft';
function loadDraft(): Draft {
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<Draft>;
      return { prompt: typeof d.prompt === 'string' ? d.prompt : '', basket: Array.isArray(d.basket) ? d.basket.filter((x) => typeof x === 'string') : [], mealType: typeof d.mealType === 'string' ? d.mealType : '' };
    }
  } catch {
    /* ignore */
  }
  return { prompt: '', basket: [], mealType: '' };
}

export function Home() {
  const { recipes, pantry, profile } = useLoaderData<typeof homeLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [draft, setDraft] = useState<Draft>(loadDraft);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState(0);
  const inFlight = useRef(false);
  const { prompt, basket, mealType } = draft;
  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }));

  // The draft survives hot reloads and trips to a recipe and back.
  useEffect(() => {
    try {
      sessionStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
    } catch {
      /* ignore */
    }
  }, [draft]);

  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setLine((l) => Math.min(COOKING_LINES.length - 1, l + 1)), 1400);
    return () => window.clearInterval(t);
  }, [busy]);

  const canGenerate = prompt.trim().length > 1 || basket.length > 0;

  async function generate() {
    if (!canGenerate || inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setLine(0);
    try {
      const { recipe } = await recipesApi.generate({ prompt: prompt.trim(), ingredientIds: basket, ...(mealType ? { mealType } : {}) });
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      nav(`/app/recipes/${recipe.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
      inFlight.current = false;
    }
  }

  async function savePantry() {
    try {
      await profileApi.savePantry(basket);
      toast('Saved as your pantry 🧺');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const firstName = (profile?.displayName ?? me.displayName ?? '').split(' ')[0];
  const vendorLabel = me.vendor === 'anthropic' ? 'Claude' : me.vendor === 'openai' ? 'OpenAI' : me.vendor === 'mock' ? 'the mock chef' : null;

  return (
    <main className="page stack-lg home">
      <section className="stack">
        <h1>{firstName ? `What are we cooking, ${firstName}?` : 'What are we cooking?'}</h1>
        <div className="ask">
          <textarea
            className="textarea ask-input"
            placeholder="Describe what you feel like — “something with the salmon in the fridge, under 30 minutes”"
            value={prompt}
            onChange={(e) => patch({ prompt: e.target.value })}
            maxLength={500}
            rows={2}
            onKeyDown={(e) => {
              if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') generate();
            }}
          />
          <div className="chips">
            {QUICK.map((q) => (
              <button key={q.label} type="button" className="chip" aria-pressed={prompt === q.prompt} onClick={() => patch({ prompt: prompt === q.prompt ? '' : q.prompt })}>
                <span aria-hidden="true">{q.emoji}</span> {q.label}
              </button>
            ))}
          </div>

          <div className="with-these">
            <div className="row" style={{ gap: 'var(--s-2)' }}>
              <span className="muted small">Cook with</span>
              {basket.length === 0 && <span className="muted small">anything —</span>}
              {basket.map((id) => {
                const i = getIngredient(id);
                return i ? (
                  <button key={id} type="button" className="chip is-on" onClick={() => patch({ basket: basket.filter((x) => x !== id) })} aria-label={`Remove ${i.name}`}>
                    <span aria-hidden="true">{i.emoji}</span> {i.name} <span aria-hidden="true">×</span>
                  </button>
                ) : null;
              })}
              <button type="button" className="chip" aria-expanded={pickerOpen} onClick={() => setPickerOpen((o) => !o)}>
                {pickerOpen ? 'Done picking' : basket.length ? '+ Add more' : '🧺 Pick ingredients'}
              </button>
              {basket.length > 0 && pantry.join() !== basket.join() && (
                <button type="button" className="btn btn-quiet btn-sm" onClick={savePantry}>
                  Save as my pantry
                </button>
              )}
            </div>
          </div>

          <div className="ask-actions">
            <select className="select" style={{ width: 'auto', minHeight: 44, padding: '6px 12px' }} value={mealType} onChange={(e) => patch({ mealType: e.target.value })} aria-label="Meal type">
              <option value="">🍽️ Any meal</option>
              {MEAL_TYPES.map((m) => (
                <option key={m} value={m}>
                  {MEAL_EMOJI[m]} {m}
                </option>
              ))}
            </select>
            {vendorLabel ? (
              <>
                <button type="button" className="btn btn-primary btn-lg" onClick={generate} disabled={!canGenerate || busy}>
                  {busy ? (
                    <>
                      <span className="spinner" style={{ borderTopColor: 'var(--sage-ink)', borderColor: 'color-mix(in oklab, var(--sage-ink) 35%, transparent)' }} /> {COOKING_LINES[line]}
                    </>
                  ) : (
                    'Write my recipe'
                  )}
                </button>
                <span className="hint">Written by {vendorLabel} with your account.</span>
              </>
            ) : (
              <>
                <Link to="/app/settings?tab=ai" className="btn btn-primary btn-lg">
                  🔌 Connect an AI to write recipes
                </Link>
                <span className="hint">
                  Claude or OpenAI, with your own key. No AI yet? <Link to="/app/u/foodi?tab=books">Browse the house kitchen’s recipe books</Link>.
                </span>
              </>
            )}
          </div>
        </div>
      </section>

      {pickerOpen && (
        <section className="picker-panel">
          <IngredientPicker selected={basket} onChange={(ids) => patch({ basket: ids })} pantry={pantry} compact basketTitle="Cook with these" basketHint="The recipe must use everything in here." />
        </section>
      )}

      <section>
        <div className="section-head">
          <h2>Your recipes</h2>
          <Link to="/app/recipes/new" className="btn btn-sm">
            ✍️ Write one by hand
          </Link>
        </div>
        {recipes.length === 0 ? (
          <Empty title="🍳 Nothing here yet">Your first recipe shows up here the moment it’s written.</Empty>
        ) : (
          <ul className="rlist">
            {recipes.map((r) => (
              <li key={r.id} className="rlist-item rlist-item-visual">
                <Link to={`/app/recipes/${r.id}`} className="rlist-visual" aria-hidden="true" tabIndex={-1}>
                  {r.cover ? <img src={mediaApi.url(r.cover.id)} alt="" loading="lazy" /> : <span className="emoji-tile">{r.emoji}</span>}
                </Link>
                <div className="stack" style={{ gap: 6 }}>
                  <h3>
                    <Link to={`/app/recipes/${r.id}`}>
                      {r.favorite && <span aria-label="Favorite">⭐ </span>}
                      {r.title}
                    </Link>
                  </h3>
                  <p className="muted small">{r.summary}</p>
                  <Meta items={[`⏱ ${minutes(r.totalMinutes)}`, `👥 ${servingsLabel(r.servings)}`, `${MEAL_EMOJI[r.mealType]} ${r.mealType}`, r.difficulty, ...(r.warnings.length ? [`⚠️ ${r.warnings.join(', ')}`] : [])]} />
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
