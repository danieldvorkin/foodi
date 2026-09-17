import { useEffect, useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MEAL_EMOJI, type BookItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { books as booksApi, media as mediaApi, type BookInput } from '../../api/types';
import { BookForm } from '../../components/Books';
import { useToast } from '../../components/Toast';
import { Avatar, Empty, Sheet } from '../../components/ui';
import { minutes, plural } from '../../lib/format';

export async function bookLoader({ params }: LoaderFunctionArgs) {
  return booksApi.get(params['id']!);
}

function Row({ item, bookId, mine, onRemove, onNote }: { item: BookItem; bookId: string; mine: boolean; onRemove: () => void; onNote: (note: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.recipeId, disabled: !mine });
  const [editing, setEditing] = useState(false);
  const [note, setNote] = useState(item.note);
  const style = { transform: CSS.Transform.toString(transform), transition };
  return (
    <li ref={setNodeRef} style={style} className={`book-item${isDragging ? ' is-dragging' : ''}`}>
      {item.available ? (
        <Link to={`/app/recipes/${item.recipeId}`} aria-hidden="true" tabIndex={-1}>
          {item.cover ? <img src={mediaApi.url(item.cover.id)} alt="" loading="lazy" /> : <span className="emoji-tile">{item.emoji}</span>}
        </Link>
      ) : (
        <span className="emoji-tile" aria-hidden="true">
          {item.emoji}
        </span>
      )}
      <div className="stack" style={{ gap: 4, minWidth: 0 }}>
        <h3>
          {item.available ? <Link to={`/app/recipes/${item.recipeId}`}>{item.title}</Link> : <span className="muted">{item.title}</span>}
          {!item.available && <span className="muted small"> · no longer shared</span>}
        </h3>
        <p className="muted small">
          {item.available ? (
            <>
              ⏱ {minutes(item.totalMinutes)} · {MEAL_EMOJI[item.mealType]} {item.mealType} · {item.difficulty} ·{' '}
            </>
          ) : null}
          by <Link to={`/app/u/${item.author.handle}`}>{item.author.displayName}</Link>
        </p>
        {editing ? (
          <form
            className="book-note-form"
            onSubmit={(e) => {
              e.preventDefault();
              onNote(note.trim());
              setEditing(false);
            }}
          >
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Why it’s in this book" autoFocus />
            <button type="submit" className="btn btn-sm">
              Save
            </button>
          </form>
        ) : item.note ? (
          <p className="book-note">
            “{item.note}”{' '}
            {mine && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setEditing(true)}>
                edit
              </button>
            )}
          </p>
        ) : mine ? (
          <button type="button" className="btn btn-quiet btn-sm" style={{ justifySelf: 'start' }} onClick={() => setEditing(true)}>
            ＋ Add a note
          </button>
        ) : null}
      </div>
      {mine && (
        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button type="button" className="btn btn-quiet btn-sm" aria-label="Drag to reorder" title="Drag to reorder" {...attributes} {...listeners} style={{ cursor: 'grab', touchAction: 'none' }}>
            ⋮⋮
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={onRemove} aria-label="Remove from book">
            ×
          </button>
        </div>
      )}
    </li>
  );
}

export function BookPage() {
  const data = useLoaderData<typeof bookLoader>();
  const { revalidate } = useRevalidator();
  const nav = useNavigate();
  const toast = useToast();
  const [items, setItems] = useState(data.items);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => setItems(data.items), [data.items]);
  const { book } = data;
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }));

  async function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const from = items.findIndex((x) => x.recipeId === active.id);
    const to = items.findIndex((x) => x.recipeId === over.id);
    const next = arrayMove(items, from, to);
    setItems(next);
    try {
      await booksApi.reorder(book.id, next.map((x) => x.recipeId));
    } catch (err) {
      toast(errorMessage(err), 'error');
      setItems(items);
    }
  }

  async function update(input: BookInput) {
    setBusy(true);
    try {
      await booksApi.update(book.id, input);
      setEditing(false);
      toast('Book updated');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!window.confirm(`Delete “${book.name}”? The recipes themselves stay where they are.`)) return;
    try {
      await booksApi.remove(book.id);
      toast('Book deleted');
      nav('/app/books', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="page-narrow stack-lg feed" style={{ maxWidth: 820 }}>
      <Link to={book.isMine ? '/app/books' : `/app/u/${book.owner.handle}`} className="muted small">
        ← {book.isMine ? 'Your books' : book.owner.displayName}
      </Link>
      <header className="book-head">
        <span className="book-emoji" aria-hidden="true">
          {book.emoji}
        </span>
        <div className="grow stack" style={{ gap: 6 }}>
          <h1>{book.name}</h1>
          {book.description && <p className="muted">{book.description}</p>}
          <p className="muted small row" style={{ gap: 8 }}>
            <Avatar name={book.owner.displayName} emoji={book.owner.avatar} />
            <Link to={`/app/u/${book.owner.handle}`}>{book.owner.displayName}</Link> · {plural(items.length, 'recipe')}
            {book.visibility === 'private' ? ' · 🔒 only you' : ''}
          </p>
        </div>
        {book.isMine && (
          <div className="row" style={{ flexWrap: 'nowrap' }}>
            <button type="button" className="btn btn-sm" onClick={() => setEditing(true)}>
              Edit
            </button>
            <button type="button" className="btn btn-quiet btn-sm" onClick={remove}>
              Delete
            </button>
          </div>
        )}
      </header>

      {items.length === 0 ? (
        <Empty title="Empty shelf" action={<Link to="/app" className="btn">Browse the feed</Link>}>
          {book.isMine ? 'Open any recipe and tap “Add to book”.' : 'Nothing here yet.'}
        </Empty>
      ) : (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={items.map((x) => x.recipeId)} strategy={verticalListSortingStrategy}>
            <ul>
              {items.map((it) => (
                <Row
                  key={it.recipeId}
                  item={it}
                  bookId={book.id}
                  mine={book.isMine}
                  onRemove={async () => {
                    setItems((xs) => xs.filter((x) => x.recipeId !== it.recipeId));
                    await booksApi.removeItem(book.id, it.recipeId).catch((e) => toast(errorMessage(e), 'error'));
                  }}
                  onNote={async (note) => {
                    setItems((xs) => xs.map((x) => (x.recipeId === it.recipeId ? { ...x, note } : x)));
                    await booksApi.note(book.id, it.recipeId, note).catch((e) => toast(errorMessage(e), 'error'));
                  }}
                />
              ))}
            </ul>
          </SortableContext>
        </DndContext>
      )}
      {book.isMine && items.length > 1 && <p className="hint">Drag the ⋮⋮ handle to reorder.</p>}

      <Sheet open={editing} onClose={() => setEditing(false)} title="Edit book">
        <BookForm initial={book} onSave={update} busy={busy} submitLabel="Save" />
      </Sheet>
    </main>
  );
}
