import { useEffect, useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import { BOOK_EMOJI, formatMoney, type RecipeBook } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { books as booksApi, type BookInput } from '../api/types';
import { plural } from '../lib/format';
import { useToast } from './Toast';
import { EmojiPicker, Sheet } from './ui';

export function BookCard({ book }: { book: RecipeBook }) {
  return (
    <Link to={`/app/books/${book.id}`} className="book">
      <span className="book-emoji" aria-hidden="true">
        {book.emoji}
      </span>
      <span>
        <h3>{book.name}</h3>
        <span className="book-private">
          {plural(book.recipeCount, 'recipe')}
          {book.visibility === 'private' ? ' · 🔒 private' : ''}
          {book.forSale ? ` · ${book.purchased ? 'owned' : formatMoney(book.priceCents)}` : ''}
          {book.promoted ? ' · 🚀' : ''}
          {!book.isMine ? ` · by ${book.owner.displayName}` : ''}
        </span>
        {book.peek.length > 0 && (
          <span className="book-peek" aria-hidden="true">
            {book.peek.map((e, i) => (
              <span key={i}>{e}</span>
            ))}
          </span>
        )}
      </span>
    </Link>
  );
}

/** Create or edit a book. */
export function BookForm({ initial, onSave, busy, submitLabel = 'Create book' }: { initial?: Partial<BookInput>; onSave: (b: BookInput) => void; busy?: boolean; submitLabel?: string }) {
  const [name, setName] = useState(initial?.name ?? '');
  const [emoji, setEmoji] = useState(initial?.emoji ?? '📚');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [visibility, setVisibility] = useState<'public' | 'private'>(initial?.visibility ?? 'public');
  function submit(e: FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    onSave({ name: name.trim(), emoji, description: description.trim(), visibility });
  }
  return (
    <form className="stack" onSubmit={submit}>
      <div className="field">
        <label htmlFor="book-name">Name</label>
        <input id="book-name" className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="Weeknight staples" autoFocus required />
      </div>
      <div className="field">
        <span className="label">Cover</span>
        <EmojiPicker options={BOOK_EMOJI} value={emoji} onChange={setEmoji} allowCustom />
      </div>
      <div className="field">
        <label htmlFor="book-desc">What goes in it</label>
        <textarea id="book-desc" className="textarea" value={description} onChange={(e) => setDescription(e.target.value)} maxLength={300} placeholder="Optional — a line about the collection" style={{ minHeight: 72 }} />
      </div>
      <div className="field">
        <span className="label">Who can see it</span>
        <div className="chips" role="radiogroup">
          <button type="button" role="radio" className="chip" aria-checked={visibility === 'public'} onClick={() => setVisibility('public')}>
            🌐 Anyone on foodi
          </button>
          <button type="button" role="radio" className="chip" aria-checked={visibility === 'private'} onClick={() => setVisibility('private')}>
            🔒 Only me
          </button>
        </div>
      </div>
      <div className="row">
        <button type="submit" className="btn btn-primary" disabled={busy || !name.trim()}>
          {busy ? 'Saving…' : submitLabel}
        </button>
      </div>
    </form>
  );
}

/** "Add to book" sheet for a recipe: tick books on and off, or make a new one right here. */
export function AddToBook({ recipeId, open, onClose }: { recipeId: string; open: boolean; onClose: () => void }) {
  const toast = useToast();
  // The list belongs to one "opening"; a fresh open (or another recipe) starts from loading again.
  const requestKey = open ? recipeId : null;
  const [loaded, setLoaded] = useState<{ key: string | null; list: (RecipeBook & { contains?: boolean })[] }>({ key: null, list: [] });
  const list = loaded.key === requestKey && requestKey ? loaded.list : null;
  const setList = (fn: (xs: (RecipeBook & { contains?: boolean })[] | null) => (RecipeBook & { contains?: boolean })[] | null) =>
    setLoaded((prev) => ({ key: requestKey, list: fn(prev.key === requestKey ? prev.list : null) ?? [] }));
  const [creating, setCreating] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!requestKey) return;
    let alive = true;
    booksApi
      .mine(requestKey)
      .then((r) => alive && setLoaded({ key: requestKey, list: r.books }))
      .catch((e) => toast(errorMessage(e), 'error'));
    return () => {
      alive = false;
    };
  }, [requestKey, toast]);

  async function toggle(b: RecipeBook & { contains?: boolean }) {
    const next = !b.contains;
    setList((xs) => xs?.map((x) => (x.id === b.id ? { ...x, contains: next, recipeCount: x.recipeCount + (next ? 1 : -1) } : x)) ?? null);
    try {
      if (next) await booksApi.add(b.id, recipeId);
      else await booksApi.removeItem(b.id, recipeId);
      toast(next ? `Added to ${b.emoji} ${b.name}` : `Removed from ${b.name}`);
    } catch (e) {
      setList((xs) => xs?.map((x) => (x.id === b.id ? { ...x, contains: !next, recipeCount: x.recipeCount - (next ? 1 : -1) } : x)) ?? null);
      toast(errorMessage(e), 'error');
    }
  }

  async function create(input: BookInput) {
    setBusy(true);
    try {
      const r = await booksApi.create(input);
      await booksApi.add(r.book.id, recipeId);
      setList((xs) => [{ ...r.book, contains: true, recipeCount: 1 }, ...(xs ?? [])]);
      setCreating(false);
      toast(`Added to ${r.book.emoji} ${r.book.name}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="📚 Add to a recipe book">
      {creating ? (
        <>
          <BookForm onSave={create} busy={busy} submitLabel="Create and add" />
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => setCreating(false)}>
            Back to your books
          </button>
        </>
      ) : list === null ? (
        <p className="muted small">Loading your books…</p>
      ) : (
        <>
          {list.length === 0 ? <p className="muted">You don’t have a book yet. Make one — it shows up on your profile.</p> : null}
          <div className="book-pick">
            {list.map((b) => (
              <button key={b.id} type="button" aria-pressed={Boolean(b.contains)} onClick={() => toggle(b)}>
                <span aria-hidden="true" style={{ fontSize: 20 }}>
                  {b.emoji}
                </span>
                <span>
                  {b.name} <span className="muted small">· {plural(b.recipeCount, 'recipe')}</span>
                </span>
                {b.contains && <span className="tick">✓</span>}
              </button>
            ))}
          </div>
          <div className="row">
            <button type="button" className="btn btn-sm" onClick={() => setCreating(true)}>
              ＋ New book
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={onClose}>
              Done
            </button>
          </div>
        </>
      )}
    </Sheet>
  );
}
