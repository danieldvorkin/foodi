import { useState, type FormEvent } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import { CATEGORY_EMOJI, formatQuantity, LIST_CATEGORIES, LIST_CATEGORY_LABEL, type ListCategory, type ShoppingItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { list as listApi } from '../../api/types';
import { useToast } from '../../components/Toast';
import { useDerivedState } from '../../lib/useDerivedState';

export async function listLoader() {
  return listApi.get();
}

/** Items by aisle, in library order; ticked lines sink to the bottom of their aisle. */
export function groupItems(items: ShoppingItem[]): { category: ListCategory; items: ShoppingItem[] }[] {
  return LIST_CATEGORIES.map((category) => ({
    category,
    items: items.filter((i) => i.category === category).sort((a, b) => Number(a.checked) - Number(b.checked) || a.position - b.position),
  })).filter((g) => g.items.length > 0);
}

export function ListPage() {
  const data = useLoaderData<typeof listLoader>();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [items, setItems] = useDerivedState(data, (d) => d.items);
  const [draft, setDraft] = useState('');
  const [adding, setAdding] = useState(false);
  const [confirmClear, setConfirmClear] = useState(false);
  const open = items.filter((i) => !i.checked).length;
  const ticked = items.length - open;

  async function add(e: FormEvent) {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    setAdding(true);
    try {
      const r = await listApi.add({ text });
      setItems(r.items);
      setDraft('');
      if (r.merged) toast('Added to a line you already had');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setAdding(false);
    }
  }

  async function toggle(item: ShoppingItem) {
    const next = !item.checked;
    setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, checked: next } : x)));
    try {
      await listApi.update(item.id, { checked: next });
    } catch (err) {
      setItems((xs) => xs.map((x) => (x.id === item.id ? { ...x, checked: !next } : x)));
      toast(errorMessage(err), 'error');
    }
  }

  async function remove(item: ShoppingItem) {
    setItems((xs) => xs.filter((x) => x.id !== item.id));
    try {
      await listApi.remove(item.id);
    } catch (err) {
      toast(errorMessage(err), 'error');
      revalidate();
    }
  }

  async function clear(checkedOnly: boolean) {
    setConfirmClear(false);
    try {
      const r = await listApi.clear(checkedOnly);
      setItems(r.items);
      toast(checkedOnly ? `Cleared ${r.removed} ticked ${r.removed === 1 ? 'line' : 'lines'}` : 'List cleared');
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  const groups = groupItems(items);
  // Which recipes the list is shopping for, once, instead of a label on every line.
  const sources = [...items.reduce((m, i) => (i.recipeId && i.recipeTitle ? m.set(i.recipeId, { title: i.recipeTitle, n: (m.get(i.recipeId)?.n ?? 0) + 1 }) : m), new Map<string, { title: string; n: number }>())];

  return (
    <main className="page list-page">
      <header className="list-head">
        <div>
          <h1>🛒 Shopping list</h1>
          <p className="muted small">{items.length === 0 ? 'Nothing on it yet.' : `${open} to get${ticked ? ` · ${ticked} ticked` : ''}`}</p>
        </div>
        {items.length > 0 && (
          <div className="row list-head-actions">
            {ticked > 0 && (
              <button type="button" className="btn btn-sm" onClick={() => clear(true)}>
                Clear ticked
              </button>
            )}
            {confirmClear ? (
              <span className="row" role="group" aria-label="Clear the whole list?">
                <span className="small muted">Clear everything?</span>
                <button type="button" className="btn btn-sm btn-danger" onClick={() => clear(false)}>
                  Yes, clear
                </button>
                <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmClear(false)}>
                  Keep
                </button>
              </span>
            ) : (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setConfirmClear(true)}>
                Clear all
              </button>
            )}
          </div>
        )}
      </header>

      <form className="list-add" onSubmit={add}>
        <label htmlFor="list-add" className="sr-only">
          Add to the list
        </label>
        <input id="list-add" className="input" value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add something — “2 lemons”, “500 g flour”, “olive oil”" autoComplete="off" enterKeyHint="done" maxLength={120} />
        <button type="submit" className="btn btn-primary" disabled={adding || !draft.trim()}>
          {adding ? 'Adding…' : 'Add'}
        </button>
      </form>

      {sources.length > 0 && (
        <p className="list-sources">
          <span className="muted small">For</span>
          {sources.map(([id, s]) => (
            <Link key={id} to={`/app/recipes/${id}`} className="chip">
              {s.title} <span className="muted">· {s.n}</span>
            </Link>
          ))}
        </p>
      )}

      {items.length === 0 ? (
        <section className="list-empty">
          <p>
            Your list fills itself from recipes: open any recipe and tap <b>Add to shopping list</b>. It scales to the servings you pick and merges lines you already have.
          </p>
          <Link to="/app" className="btn">
            Browse recipes
          </Link>
        </section>
      ) : (
        <div className="list-groups">
          {groups.map((g) => (
            <section key={g.category} className="list-group" aria-labelledby={`aisle-${g.category.replace(/\W/g, '-')}`}>
              <h2 id={`aisle-${g.category.replace(/\W/g, '-')}`} className="list-aisle">
                <span aria-hidden="true">{g.category === 'other' ? '🧺' : CATEGORY_EMOJI[g.category]}</span> {LIST_CATEGORY_LABEL[g.category]}
                <span className="muted small"> · {g.items.filter((i) => !i.checked).length}</span>
              </h2>
              <ul className="list-rows">
                {g.items.map((item) => (
                  <li key={item.id} className={`list-row${item.checked ? ' is-done' : ''}`}>
                    <label className="list-row-main">
                      <input type="checkbox" checked={item.checked} onChange={() => toggle(item)} />
                      <span className="list-row-text">
                        {(item.quantity !== null || item.unit) && (
                          <span className="list-qty num">
                            {formatQuantity(item.quantity)}
                            {item.unit ? ` ${item.unit}` : ''}
                          </span>
                        )}
                        <span>{item.text}</span>
                      </span>
                    </label>
                    <button type="button" className="list-row-del" onClick={() => remove(item)} aria-label={`Remove ${item.text}`}>
                      ×
                    </button>
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
      )}
    </main>
  );
}
