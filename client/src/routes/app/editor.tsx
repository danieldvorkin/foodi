import { useState } from 'react';
import { Link, redirect, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { AuthoredRecipeSchema, DIFFICULTY, getIngredient, MEAL_TYPES, type AuthoredRecipe, type RecipeIngredient, type Step } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { recipes as recipesApi } from '../../api/types';
import { IngredientPicker } from '../../components/IngredientPicker';
import { EmojiPicker } from '../../components/ui';
import { useToast } from '../../components/Toast';
import '../../styles/editor.css';

export async function editorLoader({ params }: LoaderFunctionArgs) {
  if (!params['id']) return { existing: null };
  const data = await recipesApi.get(params['id']);
  if (!data.isMine || data.source !== 'user') throw redirect(`/app/recipes/${params['id']}`);
  return { existing: data.recipe };
}

const RECIPE_EMOJI = ['🍝', '🍲', '🥘', '🍛', '🍜', '🥗', '🍳', '🥙', '🌮', '🍕', '🍔', '🥩', '🍗', '🐟', '🍤', '🥞', '🧁', '🍰', '🍪', '🥐', '🍞', '🥣', '🍚', '🥟', '🍱', '🥪', '🍹', '🍽️'] as const;

const blankStep = (): Step => ({ title: '', text: '', timerSeconds: null, ingredientRefs: [], temperature: null, tip: null });
const lineFor = (id: string): RecipeIngredient => {
  const p = getIngredient(id);
  return { item: p?.name ?? id, quantity: '', unit: p?.defaultUnit ?? '', preparation: null, note: null, group: null, optional: false, ingredientId: p?.id ?? null };
};

type Draft = Omit<AuthoredRecipe, 'ingredients' | 'steps'> & { ingredients: RecipeIngredient[]; steps: Step[] };

export function EditorPage() {
  const { existing } = useLoaderData<typeof editorLoader>();
  const nav = useNavigate();
  const toast = useToast();
  const [d, setD] = useState<Draft>(() =>
    existing
      ? { ...existing.content }
      : { emoji: '🍽️', title: '', summary: '', mealType: 'dinner', servings: 2, totalMinutes: 30, activeMinutes: 20, difficulty: 'easy', cuisine: null, ingredients: [], steps: [blankStep()] },
  );
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState(existing?.revisionNotes ?? '');
  const [params] = useSearchParams();
  const justAdapted = params.get('adapted') === '1';
  const adaptedFrom = existing?.adaptedFrom ?? null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  // The basket mirrors the ingredient lines that came from the library; free-text lines live alongside.
  const basketIds = d.ingredients.map((l) => l.ingredientId).filter((x): x is string => Boolean(x));
  function setBasket(ids: string[]) {
    const keep = d.ingredients.filter((l) => !l.ingredientId || ids.includes(l.ingredientId));
    const have = new Set(keep.map((l) => l.ingredientId));
    const added = ids.filter((id) => !have.has(id)).map(lineFor);
    set('ingredients', [...keep, ...added]);
  }
  const updateLine = (i: number, patch: Partial<RecipeIngredient>) => set('ingredients', d.ingredients.map((l, k) => (k === i ? { ...l, ...patch } : l)));
  const removeLine = (i: number) => {
    set('ingredients', d.ingredients.filter((_, k) => k !== i));
    set('steps', d.steps.map((s) => ({ ...s, ingredientRefs: s.ingredientRefs.filter((r) => r !== i).map((r) => (r > i ? r - 1 : r)) })));
  };
  const updateStep = (i: number, patch: Partial<Step>) => set('steps', d.steps.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const moveStep = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= d.steps.length) return;
    const next = [...d.steps];
    [next[i], next[j]] = [next[j]!, next[i]!];
    set('steps', next);
  };

  const parsed = AuthoredRecipeSchema.safeParse({ ...d, ingredients: d.ingredients.map((l) => ({ ...l, quantity: l.quantity || null, unit: l.unit || null })) });
  const problems = parsed.success ? [] : parsed.error.issues.slice(0, 3).map((i) => `${i.path.join('.') || 'recipe'}: ${i.message}`);

  async function save() {
    if (!parsed.success) return;
    setBusy(true);
    try {
      const { recipe } = existing ? await recipesApi.update(existing.id, { ...parsed.data, revisionNotes: notes.trim() }) : await recipesApi.create(parsed.data);
      toast(existing ? 'Saved' : 'Recipe saved');
      nav(`/app/recipes/${recipe.id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <main className="page editor stack-lg">
      <header className="row-between">
        <div>
          <h1>{adaptedFrom ? '🍴 Make it yours' : existing ? 'Edit recipe' : 'Write a recipe'}</h1>
          <p className="muted">
            {adaptedFrom ? 'Change anything. When you share it, the original and its author are credited automatically.' : 'Drag ingredients in from the library, then write the steps the way you’d tell a friend.'}
          </p>
        </div>
        <Link to={existing ? `/app/recipes/${existing.id}` : '/app'} className="btn btn-quiet">
          Cancel
        </Link>
      </header>

      {adaptedFrom && (
        <section className="lineage" style={{ display: 'grid', gap: 'var(--s-2)' }}>
          <div>
            {justAdapted ? 'This is your copy of ' : 'Adapted from '}
            <b>{adaptedFrom.title}</b>
            {adaptedFrom.handle ? (
              <>
                {' '}
                by <Link to={`/app/u/${adaptedFrom.handle}`}>@{adaptedFrom.handle}</Link>
              </>
            ) : null}
            .
          </div>
          <div className="field">
            <label htmlFor="notes">What you changed</label>
            <textarea id="notes" className="textarea" style={{ minHeight: 80 }} value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={2000} placeholder="Swapped the cream for coconut milk, halved the sugar, added a 10-minute rest…" />
            <p className="hint">Shown on the recipe page under the credit, so people can see how your version differs.</p>
          </div>
        </section>
      )}

      <section className="editor-meta">
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="title">Title</label>
          <div className="row" style={{ flexWrap: 'nowrap', alignItems: 'stretch' }}>
            <span className="emoji-tile" aria-hidden="true" style={{ height: 56 }}>
              {d.emoji}
            </span>
            <input id="title" className="input input-lg" value={d.title} onChange={(e) => set('title', e.target.value)} placeholder="Grandma’s Sunday ragù" maxLength={120} />
          </div>
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <span className="label">Emoji</span>
          <EmojiPicker options={RECIPE_EMOJI} value={d.emoji} onChange={(v) => set('emoji', v)} allowCustom />
        </div>
        <div className="field" style={{ gridColumn: '1 / -1' }}>
          <label htmlFor="summary">One-line summary</label>
          <input id="summary" className="input" value={d.summary} onChange={(e) => set('summary', e.target.value)} placeholder="What it is and when you make it" maxLength={400} />
        </div>
        <div className="field">
          <label htmlFor="meal">Meal</label>
          <select id="meal" className="select" value={d.mealType} onChange={(e) => set('mealType', e.target.value as Draft['mealType'])}>
            {MEAL_TYPES.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="servings">Servings</label>
          <input id="servings" className="input" type="number" min={1} max={24} value={d.servings} onChange={(e) => set('servings', Number(e.target.value) || 1)} />
        </div>
        <div className="field">
          <label htmlFor="total">Total minutes</label>
          <input id="total" className="input" type="number" min={1} max={1440} value={d.totalMinutes} onChange={(e) => set('totalMinutes', Number(e.target.value) || 1)} />
        </div>
        <div className="field">
          <label htmlFor="active">Hands-on minutes</label>
          <input id="active" className="input" type="number" min={0} max={1440} value={d.activeMinutes} onChange={(e) => set('activeMinutes', Number(e.target.value) || 0)} />
        </div>
        <div className="field">
          <label htmlFor="difficulty">Difficulty</label>
          <select id="difficulty" className="select" value={d.difficulty} onChange={(e) => set('difficulty', e.target.value as Draft['difficulty'])}>
            {DIFFICULTY.map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="cuisine">Cuisine</label>
          <input id="cuisine" className="input" value={d.cuisine ?? ''} onChange={(e) => set('cuisine', e.target.value || null)} placeholder="optional" maxLength={40} />
        </div>
      </section>

      <section className="stack">
        <h2>Ingredients</h2>
        <IngredientPicker
          selected={basketIds}
          onChange={setBasket}
          compact
          basketTitle="In this recipe"
          basketHint="Drop presets here, then set amounts below. Add anything unusual as a free-text line."
        />
        <div className="ing-editor">
          {d.ingredients.map((l, i) => (
            <div key={i} className="ing-line">
              <input className="input" placeholder="qty" aria-label="Quantity" value={l.quantity ?? ''} onChange={(e) => updateLine(i, { quantity: e.target.value })} maxLength={30} />
              <input className="input" placeholder="unit" aria-label="Unit" value={l.unit ?? ''} onChange={(e) => updateLine(i, { unit: e.target.value })} maxLength={30} list={l.ingredientId ? `units-${i}` : undefined} />
              {l.ingredientId && (
                <datalist id={`units-${i}`}>
                  {getIngredient(l.ingredientId)?.units.map((u) => (
                    <option key={u} value={u} />
                  ))}
                </datalist>
              )}
              <input className="input" placeholder="ingredient" aria-label="Ingredient" value={l.item} onChange={(e) => updateLine(i, { item: e.target.value })} maxLength={80} />
              <input className="input" placeholder="prep (diced…)" aria-label="Preparation" value={l.preparation ?? ''} onChange={(e) => updateLine(i, { preparation: e.target.value || null })} maxLength={40} />
              <label className="row small muted" style={{ gap: 6 }}>
                <input type="checkbox" checked={l.optional} onChange={(e) => updateLine(i, { optional: e.target.checked })} /> optional
              </label>
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => removeLine(i)} aria-label={`Remove ${l.item}`}>
                ×
              </button>
            </div>
          ))}
          <button type="button" className="btn btn-sm" onClick={() => set('ingredients', [...d.ingredients, { item: '', quantity: '', unit: '', preparation: null, note: null, group: null, optional: false, ingredientId: null }])}>
            Add a free-text line
          </button>
        </div>
      </section>

      <section className="stack">
        <h2>Steps</h2>
        <ol className="step-editor">
          {d.steps.map((s, i) => (
            <li key={i} className="step-edit">
              <div className="step-edit-head">
                <span className="step-n num">{i + 1}</span>
                <input className="input" placeholder="Short title, starts with a verb" aria-label="Step title" value={s.title} onChange={(e) => updateStep(i, { title: e.target.value })} maxLength={60} />
                <div className="row" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => moveStep(i, -1)} disabled={i === 0} aria-label="Move up">
                    ↑
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => moveStep(i, 1)} disabled={i === d.steps.length - 1} aria-label="Move down">
                    ↓
                  </button>
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => set('steps', d.steps.filter((_, k) => k !== i))} disabled={d.steps.length === 1} aria-label="Remove step">
                    ×
                  </button>
                </div>
              </div>
              <textarea className="textarea" placeholder="What to do, in one or two sentences." aria-label="Step text" value={s.text} onChange={(e) => updateStep(i, { text: e.target.value })} maxLength={700} rows={2} />
              <div className="step-edit-extras">
                <label className="field">
                  <span className="label">Timer (minutes)</span>
                  <input className="input" type="number" min={0} max={1440} value={s.timerSeconds ? Math.round(s.timerSeconds / 60) : ''} onChange={(e) => updateStep(i, { timerSeconds: e.target.value ? Number(e.target.value) * 60 : null })} placeholder="none" />
                </label>
                <label className="field">
                  <span className="label">Temperature</span>
                  <input className="input" value={s.temperature ?? ''} onChange={(e) => updateStep(i, { temperature: e.target.value || null })} placeholder="Oven 200°C" maxLength={60} />
                </label>
                <label className="field" style={{ gridColumn: 'span 2' }}>
                  <span className="label">Tip</span>
                  <input className="input" value={s.tip ?? ''} onChange={(e) => updateStep(i, { tip: e.target.value || null })} placeholder="What it should look like, or a common mistake" maxLength={300} />
                </label>
              </div>
              {d.ingredients.length > 0 && (
                <div className="field">
                  <span className="label">Uses</span>
                  <div className="chips">
                    {d.ingredients.map((l, k) => {
                      const on = s.ingredientRefs.includes(k);
                      return (
                        <button key={k} type="button" className="chip" aria-pressed={on} onClick={() => updateStep(i, { ingredientRefs: on ? s.ingredientRefs.filter((r) => r !== k) : [...s.ingredientRefs, k] })}>
                          {l.item || '(unnamed)'}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </li>
          ))}
        </ol>
        <button type="button" className="btn" onClick={() => set('steps', [...d.steps, blankStep()])}>
          Add a step
        </button>
      </section>

      <footer className="editor-foot">
        {problems.length > 0 && d.title && (
          <ul className="error-text small">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary btn-lg" onClick={save} disabled={!parsed.success || busy}>
            {busy ? 'Saving…' : existing ? 'Save changes' : 'Save recipe'}
          </button>
        </div>
      </footer>
    </main>
  );
}
