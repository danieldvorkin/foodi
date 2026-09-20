import { Fragment, useEffect, useState, type CSSProperties } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { addDays, dayLabel, PLAN_SLOT_EMOJI, PLAN_SLOT_LABEL, PLAN_SLOTS, todayLocal, weekDates, weekLabel, weekStart, type PlanEntry, type PlanSlot } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { plan as planApi, type PlanCandidate } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Sheet } from '../../components/ui';
import { useDerivedState } from '../../lib/useDerivedState';

export async function planLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const week = weekStart(url.searchParams.get('week') ?? todayLocal());
  return planApi.week(week);
}

type Cell = { date: string; slot: PlanSlot };

export function PlanPage() {
  const data = useLoaderData<typeof planLoader>();
  const [, setParams] = useSearchParams();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [entries, setEntries] = useDerivedState(data, (d) => d.entries);
  const [adding, setAdding] = useState<Cell | null>(null);
  const [editing, setEditing] = useState<PlanEntry | null>(null);
  const [filling, setFilling] = useState(false);
  const today = todayLocal();
  const dates = weekDates(data.week);
  const thisWeek = weekStart(today) === data.week;
  const go = (week: string) => setParams(week === weekStart(today) ? {} : { week });

  const at = (date: string, slot: PlanSlot) => entries.filter((e) => e.date === date && e.slot === slot).sort((a, b) => a.position - b.position);
  const meals = entries.filter((e) => e.slot !== 'prep');
  const withRecipe = entries.filter((e) => e.recipeId && !e.done).length;

  async function toggleDone(e: PlanEntry) {
    const next = !e.done;
    setEntries((xs) => xs.map((x) => (x.id === e.id ? { ...x, done: next } : x)));
    try {
      await planApi.update(e.id, { done: next });
    } catch (err) {
      setEntries((xs) => xs.map((x) => (x.id === e.id ? { ...x, done: !next } : x)));
      toast(errorMessage(err), 'error');
    }
  }

  async function fillList() {
    setFilling(true);
    try {
      const r = await planApi.toList(data.week);
      toast(`${r.added} ${r.added === 1 ? 'line' : 'lines'} added to your shopping list${r.merged ? `, ${r.merged} merged` : ''}${r.skipped.length ? ` · skipped ${r.skipped.join(', ')}` : ''}`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setFilling(false);
    }
  }

  return (
    <main className="page plan-page">
      <header className="plan-head">
        <div>
          <h1>📅 Meal plan</h1>
          <p className="muted small">{meals.length === 0 ? 'Nothing planned this week yet.' : `${meals.length} ${meals.length === 1 ? 'meal' : 'meals'} planned${entries.length - meals.length ? ` · ${entries.length - meals.length} prep` : ''}`}</p>
        </div>
        <div className="plan-nav" role="group" aria-label="Week">
          <button type="button" className="btn btn-sm" onClick={() => go(addDays(data.week, -7))} aria-label="Previous week">
            ‹
          </button>
          <span className="plan-week num">{weekLabel(data.week)}</span>
          <button type="button" className="btn btn-sm" onClick={() => go(addDays(data.week, 7))} aria-label="Next week">
            ›
          </button>
          {!thisWeek && (
            <button type="button" className="btn btn-quiet btn-sm" onClick={() => go(weekStart(today))}>
              This week
            </button>
          )}
        </div>
        <button type="button" className="btn btn-primary btn-sm plan-fill" onClick={fillList} disabled={filling || withRecipe === 0} title={withRecipe === 0 ? 'Put a recipe on the plan first' : undefined}>
          {filling ? 'Adding…' : '🛒 Add this week to the list'}
        </button>
      </header>

      {entries.length === 0 && (
        <p className="plan-empty muted">
          Tap <b>＋</b> in any meal to plan it — from your recipes, the house kitchen, or just a word like “leftovers”. Use the <b>Prep</b> lane for batch-cooking days.
        </p>
      )}

      {/* Day-major in the DOM (a day, then its slots) so a phone reads naturally; the desktop grid places cells by variables. */}
      <div className="plan-grid" aria-label={`Week of ${weekLabel(data.week)}`}>
        <div className="plan-corner" style={{ '--c': 1, '--r': 1 } as CSSProperties} aria-hidden="true" />
        {PLAN_SLOTS.map((slot, j) => (
          <div key={slot} className={`plan-slot${slot === 'prep' ? ' is-prep' : ''}`} style={{ '--c': 1, '--r': j + 2 } as CSSProperties} aria-hidden="true">
            <span>{PLAN_SLOT_EMOJI[slot]}</span> {PLAN_SLOT_LABEL[slot]}
          </div>
        ))}
        {dates.map((d, i) => (
          <Fragment key={d}>
            <h2 className={`plan-day${d === today ? ' is-today' : ''}`} style={{ '--c': i + 2, '--r': 1 } as CSSProperties}>
              <span className="plan-day-name">{dayLabel(d, true)}</span>
              <span className="plan-day-num num">{Number(d.slice(-2))}</span>
              <span className="plan-day-full">{dayLabel(d)}</span>
            </h2>
            {PLAN_SLOTS.map((slot, j) => (
              <section key={slot} className={`plan-cell${d === today ? ' is-today' : ''}${slot === 'prep' ? ' is-prep' : ''}`} style={{ '--c': i + 2, '--r': j + 2 } as CSSProperties} aria-label={`${PLAN_SLOT_LABEL[slot]}, ${dayLabel(d)}`}>
                <span className="plan-cell-slot" aria-hidden="true">
                  {PLAN_SLOT_EMOJI[slot]} {PLAN_SLOT_LABEL[slot]}
                </span>
                {at(d, slot).map((e) => (
                  <button key={e.id} type="button" className={`plan-entry${e.done ? ' is-done' : ''}`} onClick={() => setEditing(e)} aria-label={`${e.title}${e.done ? ', done' : ''}`}>
                    <span aria-hidden="true">{e.emoji}</span>
                    <span className="plan-entry-title">{e.title}</span>
                    {e.servings > 1 && e.slot !== 'prep' && <span className="plan-entry-serv num">×{e.servings}</span>}
                  </button>
                ))}
                <button type="button" className="plan-add" onClick={() => setAdding({ date: d, slot })} aria-label={`Add to ${PLAN_SLOT_LABEL[slot]} on ${dayLabel(d)}`}>
                  ＋
                </button>
              </section>
            ))}
          </Fragment>
        ))}
      </div>

      {adding && (
        <PickSheet
          cell={adding}
          onClose={() => setAdding(null)}
          onAdded={(entry) => {
            setEntries((xs) => [...xs, entry]);
            setAdding(null);
          }}
        />
      )}
      {editing && (
        <EntrySheet
          entry={editing}
          onClose={() => setEditing(null)}
          onToggleDone={() => {
            void toggleDone(editing);
            setEditing({ ...editing, done: !editing.done });
          }}
          onChanged={() => {
            setEditing(null);
            revalidate();
          }}
          onRemoved={() => {
            setEntries((xs) => xs.filter((x) => x.id !== editing.id));
            setEditing(null);
          }}
        />
      )}
    </main>
  );
}

/** Choose what goes in a slot: search your recipes and the house kitchen, or type a dish. */
function PickSheet({ cell, onClose, onAdded }: { cell: Cell; onClose: () => void; onAdded: (e: PlanEntry) => void }) {
  const toast = useToast();
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PlanCandidate[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const t = setTimeout(() => {
      planApi
        .candidates(q)
        .then((r) => alive && setResults(r.recipes))
        .catch((e) => alive && toast(errorMessage(e), 'error'));
    }, 150);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [q, toast]);

  async function add(body: { recipeId?: string; title?: string }) {
    setBusy(body.recipeId ?? body.title ?? '');
    try {
      const r = await planApi.add({ date: cell.date, slot: cell.slot, note: '', ...body });
      onAdded(r.entry);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const free = q.trim();
  return (
    <Sheet open onClose={onClose} title={`${PLAN_SLOT_EMOJI[cell.slot]} ${PLAN_SLOT_LABEL[cell.slot]} · ${dayLabel(cell.date)}`}>
      <div className="stack">
        <label htmlFor="plan-q" className="sr-only">
          Search recipes or type a dish
        </label>
        <input id="plan-q" className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder={cell.slot === 'prep' ? 'What are you prepping? “Roast a tray of veg”' : 'Search your recipes, or type “leftovers”'} autoFocus autoComplete="off" />
        {free && !results?.some((r) => r.title.toLowerCase() === free.toLowerCase()) && (
          <button type="button" className="plan-pick plan-pick-free" onClick={() => add({ title: free })} disabled={busy !== null}>
            <span aria-hidden="true">✏️</span>
            <span>
              Just write “{free}” <span className="muted small">— no recipe attached</span>
            </span>
          </button>
        )}
        {results === null ? (
          <p className="muted small">Loading…</p>
        ) : results.length === 0 && !free ? (
          <p className="muted small">No recipes yet — write one, ask the AI, or type a dish above.</p>
        ) : (
          <ul className="plan-picks">
            {results.map((r) => (
              <li key={r.id}>
                <button type="button" className="plan-pick" onClick={() => add({ recipeId: r.id })} disabled={busy !== null}>
                  <span aria-hidden="true">{r.emoji}</span>
                  <span>
                    {r.title}
                    <span className="muted small">
                      {' '}
                      · {r.mine ? 'yours' : 'house kitchen'}
                      {r.totalMinutes ? ` · ${r.totalMinutes} min` : ''}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Sheet>
  );
}

/** One planned thing: servings, note, done, move, open, remove. */
function EntrySheet({ entry, onClose, onToggleDone, onChanged, onRemoved }: { entry: PlanEntry; onClose: () => void; onToggleDone: () => void; onChanged: () => void; onRemoved: () => void }) {
  const toast = useToast();
  const [servings, setServings] = useState(entry.servings);
  const [note, setNote] = useState(entry.note);
  const [date, setDate] = useState(entry.date);
  const [slot, setSlot] = useState<PlanSlot>(entry.slot);
  const [busy, setBusy] = useState(false);
  const dirty = servings !== entry.servings || note !== entry.note || date !== entry.date || slot !== entry.slot;

  async function save() {
    setBusy(true);
    try {
      await planApi.update(entry.id, { servings, note, date, slot });
      toast('Saved');
      onChanged();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  async function remove() {
    try {
      await planApi.remove(entry.id);
      toast('Taken off the plan');
      onRemoved();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <Sheet open onClose={onClose} title={`${entry.emoji} ${entry.title}`}>
      <div className="stack">
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="row" style={{ gap: 8 }}>
            <input type="checkbox" checked={entry.done} onChange={onToggleDone} /> {entry.slot === 'prep' ? 'Prepped' : 'Cooked'}
          </label>
          {entry.recipeId && entry.recipeAvailable && (
            <Link to={`/app/recipes/${entry.recipeId}`} className="btn btn-sm">
              Open recipe →
            </Link>
          )}
          {entry.recipeId && entry.recipeAvailable && (
            <Link to={`/cook/${entry.recipeId}`} className="btn btn-primary btn-sm">
              Start cooking
            </Link>
          )}
        </div>
        {entry.slot !== 'prep' && (
          <div className="row" role="group" aria-label="Servings">
            <span className="label">Servings</span>
            <button type="button" className="btn btn-sm" onClick={() => setServings((n) => Math.max(1, n - 1))} aria-label="Fewer servings" disabled={servings <= 1}>
              −
            </button>
            <span className="num" style={{ minWidth: '2ch', textAlign: 'center' }}>
              {servings}
            </span>
            <button type="button" className="btn btn-sm" onClick={() => setServings((n) => Math.min(48, n + 1))} aria-label="More servings" disabled={servings >= 48}>
              +
            </button>
          </div>
        )}
        <div className="row" style={{ flexWrap: 'wrap' }}>
          <label className="field" style={{ margin: 0 }}>
            <span className="label">Day</span>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </label>
          <label className="field" style={{ margin: 0 }}>
            <span className="label">Slot</span>
            <select className="input" value={slot} onChange={(e) => setSlot(e.target.value as PlanSlot)}>
              {PLAN_SLOTS.map((s) => (
                <option key={s} value={s}>
                  {PLAN_SLOT_EMOJI[s]} {PLAN_SLOT_LABEL[s]}
                </option>
              ))}
            </select>
          </label>
        </div>
        <label className="field" style={{ margin: 0 }}>
          <span className="label">Note</span>
          <textarea className="textarea" rows={2} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Double the sauce, use up the spinach…" />
        </label>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !dirty}>
            {busy ? 'Saving…' : 'Save'}
          </button>
          <button type="button" className="btn btn-quiet" onClick={remove}>
            Remove
          </button>
        </div>
      </div>
    </Sheet>
  );
}
