import { useState } from 'react';
import { Link } from 'react-router';
import { parseQuantity, tidy, type RecipeIngredient } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { list as listApi } from '../api/types';
import { ingredientLine } from './RecipeParts';
import { useToast } from './Toast';
import { Sheet } from './ui';

/**
 * "Add to shopping list" for a recipe: pick the servings, untick what you already have, add.
 * Optional garnishes start unticked. Quantities preview scaled; words ("a handful") stay words.
 */
export function AddToList({ recipeId, title, ingredients, servings, open, onClose }: { recipeId: string; title: string; ingredients: RecipeIngredient[]; servings: number; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [want, setWant] = useState(servings);
  const [picked, setPicked] = useState<Set<number>>(() => new Set(ingredients.map((_, i) => i).filter((i) => !ingredients[i]!.optional)));
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ added: number; merged: number } | null>(null);
  const factor = servings ? want / servings : 1;

  function toggle(i: number) {
    setPicked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });
  }

  async function add() {
    if (picked.size === 0) return;
    setBusy(true);
    try {
      const r = await listApi.add({ fromRecipe: { recipeId, servings: want, ingredientIndexes: [...picked].sort((a, b) => a - b) } });
      setDone({ added: r.added, merged: r.merged });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  function preview(ing: RecipeIngredient): string {
    const q = parseQuantity(ing.quantity);
    if (q === null || factor === 1) return ingredientLine(ing);
    return ingredientLine({ ...ing, quantity: String(tidy(q * factor)) });
  }

  return (
    <Sheet open={open} onClose={onClose} title="🛒 Add to shopping list">
      {done ? (
        <div className="stack">
          <p>
            {done.added + done.merged === 0 ? 'Nothing was added.' : `${done.added} ${done.added === 1 ? 'line' : 'lines'} added${done.merged ? `, ${done.merged} merged into ${done.merged === 1 ? 'one you already had' : 'ones you already had'}` : ''}.`}
          </p>
          <div className="row">
            <Link to="/app/list" className="btn btn-primary">
              Open the list
            </Link>
            <button type="button" className="btn btn-quiet" onClick={onClose}>
              Done
            </button>
          </div>
        </div>
      ) : (
        <div className="stack">
          <p className="muted small">{title}</p>
          <div className="row" role="group" aria-label="Servings">
            <span className="label">Servings</span>
            <button type="button" className="btn btn-sm" onClick={() => setWant((n) => Math.max(1, n - 1))} aria-label="Fewer servings" disabled={want <= 1}>
              −
            </button>
            <span className="num" style={{ minWidth: '2ch', textAlign: 'center' }} aria-live="polite">
              {want}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setWant((n) => Math.min(48, n + 1))} aria-label="More servings" disabled={want >= 48}>
              +
            </button>
            {want !== servings && <span className="muted small">(recipe makes {servings})</span>}
          </div>
          <ul className="list-pick">
            {ingredients.map((ing, i) => (
              <li key={i}>
                <label>
                  <input type="checkbox" checked={picked.has(i)} onChange={() => toggle(i)} />
                  <span>
                    {preview(ing)}
                    {ing.optional && <span className="muted"> (optional)</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={add} disabled={busy || picked.size === 0}>
              {busy ? 'Adding…' : `Add ${picked.size} ${picked.size === 1 ? 'item' : 'items'}`}
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => setPicked(new Set(picked.size === ingredients.length ? [] : ingredients.map((_, i) => i)))}>
              {picked.size === ingredients.length ? 'Untick all' : 'Tick all'}
            </button>
          </div>
        </div>
      )}
    </Sheet>
  );
}
