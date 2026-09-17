import { useState } from 'react';
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import type { BlogPost, MediaItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { blog as blogApi, media as mediaApi, recipes as recipesApi, type BlogInput } from '../../api/types';
import { MediaThumb, MediaUploader } from '../../components/Media';
import { Prose } from '../../components/Prose';
import { useToast } from '../../components/Toast';
import { minutes } from '../../lib/format';

export async function blogEditorLoader({ params }: LoaderFunctionArgs) {
  const [mine, existing] = await Promise.all([recipesApi.list(), params['id'] ? blogApi.get(params['id']) : Promise.resolve(null)]);
  if (existing && !existing.post.isMine) throw new Response('Not yours', { status: 403 });
  return { mine: mine.recipes, post: existing?.post ?? null };
}

const DRAFT_KEY = 'foodi.blog.draft';

function initial(post: BlogPost | null): BlogInput {
  if (post) return { title: post.title, body: post.body, status: post.status, recipeIds: post.recipes.map((r) => r.id), mediaIds: post.media.map((m) => m.id), coverMediaId: post.cover?.id ?? null };
  try {
    const raw = sessionStorage.getItem(DRAFT_KEY);
    if (raw) {
      const d = JSON.parse(raw) as Partial<BlogInput>;
      return { title: d.title ?? '', body: d.body ?? '', status: 'published', recipeIds: d.recipeIds ?? [], mediaIds: [], coverMediaId: null };
    }
  } catch {
    /* ignore */
  }
  return { title: '', body: '', status: 'published', recipeIds: [], mediaIds: [], coverMediaId: null };
}

export function BlogEditor() {
  const { mine, post } = useLoaderData<typeof blogEditorLoader>();
  const nav = useNavigate();
  const toast = useToast();
  const [form, setForm] = useState<BlogInput>(() => initial(post));
  const [media, setMedia] = useState<MediaItem[]>(post?.media ?? []);
  const [preview, setPreview] = useState(false);
  const [busy, setBusy] = useState<'draft' | 'publish' | null>(null);
  const patch = (p: Partial<BlogInput>) => {
    setForm((f) => {
      const next = { ...f, ...p };
      if (!post) {
        try {
          sessionStorage.setItem(DRAFT_KEY, JSON.stringify({ title: next.title, body: next.body, recipeIds: next.recipeIds }));
        } catch {
          /* ignore */
        }
      }
      return next;
    });
  };

  async function save(status: 'draft' | 'published') {
    if (!form.title.trim() || !form.body.trim()) {
      toast('Give it a title and some words first.', 'error');
      return;
    }
    setBusy(status === 'draft' ? 'draft' : 'publish');
    try {
      const body: BlogInput = { ...form, status, mediaIds: media.map((m) => m.id), coverMediaId: form.coverMediaId && media.some((m) => m.id === form.coverMediaId) ? form.coverMediaId : null };
      const r = post ? await blogApi.update(post.id, body) : await blogApi.create(body);
      try {
        sessionStorage.removeItem(DRAFT_KEY);
      } catch {
        /* ignore */
      }
      toast(status === 'draft' ? 'Draft saved' : post?.status === 'published' ? 'Post updated' : 'Published');
      nav(status === 'draft' ? `/app/blog/${r.post.id}/edit` : `/app/blog/${r.post.id}`, { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(null);
    }
  }

  const toggleRecipe = (id: string) => patch({ recipeIds: form.recipeIds.includes(id) ? form.recipeIds.filter((x) => x !== id) : form.recipeIds.length < 6 ? [...form.recipeIds, id] : form.recipeIds });

  return (
    <main className="page-narrow stack-lg blog-editor" style={{ maxWidth: 780 }}>
      <header className="row-between">
        <div>
          <h1>{post ? '📓 Edit post' : '📓 New post'}</h1>
          <p className="muted">A story, a technique, a week of cooking. Attach the recipes so people can cook along.</p>
        </div>
        <Link to={post ? `/app/blog/${post.id}` : '/app/blog'} className="btn btn-quiet btn-sm">
          Cancel
        </Link>
      </header>

      <div className="field">
        <label htmlFor="bt" className="sr-only">
          Title
        </label>
        <input id="bt" className="input input-title" placeholder="Title" value={form.title} onChange={(e) => patch({ title: e.target.value })} maxLength={120} />
      </div>

      <div className="chips" role="tablist" aria-label="Write or preview">
        <button type="button" role="tab" className="chip" aria-selected={!preview} aria-pressed={!preview} onClick={() => setPreview(false)}>
          ✍️ Write
        </button>
        <button type="button" role="tab" className="chip" aria-selected={preview} aria-pressed={preview} onClick={() => setPreview(true)}>
          👀 Preview
        </button>
      </div>

      {preview ? (
        <div className="card" style={{ padding: 'var(--s-5)' }}>
          {form.body.trim() ? <Prose text={form.body} /> : <p className="muted">Nothing to preview yet.</p>}
        </div>
      ) : (
        <div className="field">
          <label htmlFor="bb" className="sr-only">
            Body
          </label>
          <textarea id="bb" className="textarea" placeholder="Start with the dish, the mistake, or the moment it clicked…" value={form.body} onChange={(e) => patch({ body: e.target.value })} maxLength={20000} />
          <div className="md-help">
            <span>
              <code>## Heading</code>
            </span>
            <span>
              <code>- list item</code>
            </span>
            <span>
              <code>**bold**</code>
            </span>
            <span>
              <code>_italic_</code>
            </span>
            <span>
              <code>[link](https://…)</code>
            </span>
            <span>Blank line between paragraphs.</span>
          </div>
        </div>
      )}

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-18)' }}>🍽️ Recipes in this post</h2>
        {mine.length === 0 ? (
          <p className="muted small">
            You have no recipes yet — <Link to="/app/cook">cook one</Link> or <Link to="/app/recipes/new">write one</Link> and it can be attached here.
          </p>
        ) : (
          <div className="chips">
            {mine.map((r) => (
              <button key={r.id} type="button" className="chip" aria-pressed={form.recipeIds.includes(r.id)} onClick={() => toggleRecipe(r.id)} title={`${minutes(r.totalMinutes)} · ${r.difficulty}`}>
                {r.emoji} {r.title}
              </button>
            ))}
          </div>
        )}
        <p className="hint">Up to six. Private recipes become visible to readers of the post only once you share them; otherwise they show just for you.</p>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-18)' }}>📷 Photos</h2>
        <MediaUploader compact onUploaded={(m) => setMedia((xs) => (xs.length < 8 ? [...xs, m] : xs))} label="Add photos — pick one as the cover" />
        {media.length > 0 && (
          <div className="gallery gallery-strip">
            {media.map((m) => (
              <div key={m.id} className="gallery-item" style={{ display: 'grid', gap: 4 }}>
                <MediaThumb m={m} size="sm" />
                {m.kind === 'image' && (
                  <button type="button" className="chip" style={{ justifySelf: 'center' }} aria-pressed={form.coverMediaId === m.id} onClick={() => patch({ coverMediaId: form.coverMediaId === m.id ? null : m.id })}>
                    {form.coverMediaId === m.id ? '★ Cover' : 'Set cover'}
                  </button>
                )}
                <button
                  type="button"
                  className="gallery-del"
                  aria-label="Remove"
                  onClick={async () => {
                    await mediaApi.remove(m.id).catch(() => {});
                    setMedia((xs) => xs.filter((x) => x.id !== m.id));
                    if (form.coverMediaId === m.id) patch({ coverMediaId: null });
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <div className="row">
        <button type="button" className="btn btn-primary btn-lg" onClick={() => save('published')} disabled={busy !== null}>
          {busy === 'publish' ? 'Publishing…' : post?.status === 'published' ? 'Save changes' : 'Publish'}
        </button>
        {post?.status !== 'published' && (
          <button type="button" className="btn btn-lg" onClick={() => save('draft')} disabled={busy !== null}>
            {busy === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        )}
        {post?.status === 'published' && (
          <button type="button" className="btn btn-quiet btn-lg" onClick={() => save('draft')} disabled={busy !== null}>
            Unpublish to draft
          </button>
        )}
      </div>
    </main>
  );
}
