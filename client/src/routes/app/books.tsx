import { useState } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { books as booksApi, type BookInput } from '../../api/types';
import { BookCard, BookForm } from '../../components/Books';
import { useToast } from '../../components/Toast';
import { Empty, Sheet } from '../../components/ui';
import '../../styles/social.css';

export async function booksLoader() {
  return booksApi.mine();
}

export function BooksPage() {
  const { books } = useLoaderData<typeof booksLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function create(input: BookInput) {
    setBusy(true);
    try {
      await booksApi.create(input);
      setOpen(false);
      toast('Book created');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page stack-lg feed">
      <header className="row-between">
        <div>
          <h1>📚 Your recipe books</h1>
          <p className="muted">Collections you curate: yours, and recipes other people shared. Public books show on your profile.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)}>
          ＋ New book
        </button>
      </header>
      {books.length === 0 ? (
        <Empty title="📚 No books yet" action={<button type="button" className="btn" onClick={() => setOpen(true)}>Start one</button>}>
          Try “Weeknight staples”, “Things to cook for Mum”, or “Camping”. Add recipes from any recipe page.
        </Empty>
      ) : (
        <div className="book-grid">
          {books.map((b) => (
            <BookCard key={b.id} book={b} />
          ))}
        </div>
      )}
      <p className="hint">
        Find recipes to shelve on the <Link to="/app">feed</Link> — every recipe page has an “Add to book” button.
      </p>
      <Sheet open={open} onClose={() => setOpen(false)} title="📚 New recipe book">
        <BookForm onSave={create} busy={busy} />
      </Sheet>
    </main>
  );
}
