import { useState } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import type { Post } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { recipes as recipesApi, social } from '../../api/types';
import { PostCard } from '../../components/PostCard';
import { useToast } from '../../components/Toast';
import { Empty, Sheet } from '../../components/ui';
import '../../styles/social.css';

export async function feedLoader() {
  const [feed, mine] = await Promise.all([social.feed(), recipesApi.list()]);
  return { ...feed, mine: mine.recipes };
}

export function FeedPage() {
  const data = useLoaderData<typeof feedLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [more, setMore] = useState<Post[]>([]);
  const [nextBefore, setNextBefore] = useState(data.nextBefore);
  const [open, setOpen] = useState(false);
  const [recipeId, setRecipeId] = useState(data.mine[0]?.id ?? '');
  const [caption, setCaption] = useState('');
  const [busy, setBusy] = useState(false);
  const posts = [...data.posts, ...more];

  async function loadMore() {
    if (!nextBefore) return;
    const r = await social.feed(nextBefore);
    setMore((m) => [...m, ...r.posts]);
    setNextBefore(r.nextBefore);
  }

  async function share() {
    if (!recipeId) return;
    setBusy(true);
    try {
      await social.createPost(recipeId, caption.trim());
      setOpen(false);
      setCaption('');
      toast('Shared');
      setMore([]);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-narrow stack-lg feed">
      <header className="row-between">
        <div>
          <h1>Feed</h1>
          <p className="muted">What people here are cooking.</p>
        </div>
        <button type="button" className="btn btn-primary" onClick={() => setOpen(true)} disabled={data.mine.length === 0}>
          Share a recipe
        </button>
      </header>

      {posts.length === 0 ? (
        <Empty title="Quiet in here" action={data.mine.length ? <button type="button" className="btn" onClick={() => setOpen(true)}>Share the first one</button> : <Link to="/app" className="btn">Write a recipe first</Link>}>
          Nobody has shared a recipe yet.
        </Empty>
      ) : (
        <div className="stack">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onDeleted={() => { setMore([]); revalidate(); }} />
          ))}
          {nextBefore && (
            <button type="button" className="btn btn-block" onClick={loadMore}>
              Older posts
            </button>
          )}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title="Share a recipe">
        <div className="field">
          <label htmlFor="which">Recipe</label>
          <select id="which" className="select" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            {data.mine.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="caption">Caption</label>
          <textarea id="caption" className="textarea" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go? Anything you changed?" maxLength={1000} />
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy || !recipeId}>
            {busy ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </Sheet>
    </main>
  );
}
