import { useEffect, useState } from 'react';
import { Link, NavLink, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import type { FeedItem, FeedScope, MediaItem } from '@foodi/shared';
import { MediaThumb, MediaUploader } from '../../components/Media';
import { errorMessage } from '../../api/client';
import { media as mediaApi, recipes as recipesApi, social, type Person, type RecipeSummary } from '../../api/types';
import { BlogCard } from '../../components/BlogCard';
import { BookFeedCard, PromoCard } from '../../components/Commerce';
import { formatMoney, type Promotion } from '@foodi/shared';
import { commerce as commerceApi } from '../../api/types';
import { PostCard } from '../../components/PostCard';
import { FollowButton } from '../../components/People';
import { useToast } from '../../components/Toast';
import { Avatar, Empty, Sheet } from '../../components/ui';
import { useMe } from './layout';

export async function feedLoader({ request }: { request: Request }) {
  const scope: FeedScope = new URL(request.url).searchParams.get('scope') === 'following' ? 'following' : 'everyone';
  const [feed, mine, sugg, featured] = await Promise.all([social.feed(scope), recipesApi.list(), social.suggestions(), commerceApi.featured().catch(() => ({ promotions: [] as Promotion[] }))]);
  return { ...feed, scope, mine: mine.recipes, people: sugg.people, featured: featured.promotions };
}

function LeftRail({ mine }: { mine: RecipeSummary[] }) {
  const me = useMe();
  return (
    <aside className="rail rail-left" aria-label="Shortcuts">
      <div className="rail-section">
        <Link to={`/app/u/${me.handle}`} className="rail-me">
          <Avatar name={me.displayName ?? '?'} emoji={me.avatar} />
          <span style={{ minWidth: 0 }}>
            <b>{me.displayName ?? me.handle}</b>
            <span className="muted small">@{me.handle}</span>
          </span>
        </Link>
        <nav className="rail-nav" aria-label="Your things">
          <NavLink to="/app" end>
            <span className="ico">📣</span> Feed
          </NavLink>
          <NavLink to="/app/cook">
            <span className="ico">🥘</span> Cook something
          </NavLink>
          <NavLink to="/app/blog">
            <span className="ico">📓</span> Blog
          </NavLink>
          <NavLink to="/app/books">
            <span className="ico">📚</span> Recipe books
          </NavLink>
          <NavLink to="/app/shop">
            <span className="ico">🛍️</span> Shop
          </NavLink>
          <NavLink to="/app/notifications">
            <span className="ico">🔔</span> Notifications
          </NavLink>
          <NavLink to="/app/settings">
            <span className="ico">⚙️</span> Settings
          </NavLink>
          {me.role === 'admin' && (
            <NavLink to="/admin">
              <span className="ico">🛠</span> Admin
            </NavLink>
          )}
        </nav>
      </div>
      <div className="rail-section">
        <h3>Your latest recipes</h3>
        {mine.length === 0 ? (
          <p className="muted small">
            Nothing yet. <Link to="/app/cook">Cook something</Link> or <Link to="/app/recipes/new">write one</Link>.
          </p>
        ) : (
          <div className="rail-list">
            {mine.slice(0, 5).map((r) => (
              <Link key={r.id} to={`/app/recipes/${r.id}`} className="rail-recipe">
                {r.cover ? <img src={mediaApi.url(r.cover.id)} alt="" loading="lazy" /> : <span className="emoji-tile">{r.emoji}</span>}
                <span className="name">{r.title}</span>
              </Link>
            ))}
            {mine.length > 5 && (
              <Link to="/app/cook#recipes" className="muted small" style={{ padding: '4px' }}>
                All {mine.length} recipes →
              </Link>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function RightRail({ people, items, featured }: { people: Person[]; items: FeedItem[]; featured: Promotion[] }) {
  const [gone, setGone] = useState<Set<string>>(new Set());
  const blogs = items.filter((i) => i.type === 'blog').slice(0, 4);
  const suggestions = people.filter((p) => !gone.has(p.id));
  return (
    <aside className="rail rail-right" aria-label="Around foodi">
      {featured.length > 0 && (
        <div className="rail-section">
          <h3>Featured books · promoted</h3>
          <ul className="rail-list">
            {featured.map((p) => (
              <li key={p.id}>
                <span className="emoji-tile" aria-hidden="true" style={{ width: 36, height: 36, fontSize: 18 }}>
                  {p.book.emoji}
                </span>
                <span className="grow">
                  <Link to={`/app/books/${p.book.id}`} className="name" onClick={() => void commerceApi.click(p.id).catch(() => {})}>
                    {p.book.name}
                  </Link>
                  <span className="sub">
                    {p.book.owner.displayName}
                    {p.book.forSale ? ` · ${formatMoney(p.book.priceCents)}` : ''}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="rail-section">
        <h3>People to follow</h3>
        {suggestions.length === 0 ? (
          <p className="muted small">You follow everyone here already. 🎉</p>
        ) : (
          <ul className="rail-list">
            {suggestions.slice(0, 5).map((p) => (
              <li key={p.id}>
                <Link to={`/app/u/${p.handle}`} aria-label={p.displayName}>
                  <Avatar name={p.displayName} emoji={p.avatar} />
                </Link>
                <span className="grow">
                  <Link to={`/app/u/${p.handle}`} className="name">
                    {p.displayName}
                  </Link>
                  <span className="sub">{p.bio || `${p.followerCount} ${p.followerCount === 1 ? 'follower' : 'followers'}`}</span>
                </span>
                <FollowButton handle={p.handle} following={false} onChange={(f) => f && setGone((s) => new Set(s).add(p.id))} />
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="rail-section">
        <h3>Fresh from the blog</h3>
        {blogs.length === 0 ? (
          <p className="muted small">
            No posts yet. <Link to="/app/blog/new">Write the first one</Link>.
          </p>
        ) : (
          <ul className="rail-list">
            {blogs.map((i) =>
              i.type === 'blog' ? (
                <li key={i.blog.id}>
                  <span className="grow">
                    <Link to={`/app/blog/${i.blog.id}`} className="name">
                      {i.blog.title}
                    </Link>
                    <span className="sub">
                      {i.blog.author.displayName} · {i.blog.readingMinutes} min
                    </span>
                  </span>
                </li>
              ) : null,
            )}
          </ul>
        )}
      </div>
      <div className="rail-section">
        <p className="muted tiny">Recipes are written with your own AI account and stored on this machine. 🔌 Keys live in Settings.</p>
      </div>
    </aside>
  );
}

export function FeedPage() {
  const data = useLoaderData<typeof feedLoader>();
  const me = useMe();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [more, setMore] = useState<FeedItem[]>([]);
  const [nextBefore, setNextBefore] = useState(data.nextBefore);
  const [open, setOpen] = useState(params.get('share') === '1' && data.mine.length > 0);
  const [recipeId, setRecipeId] = useState(data.mine[0]?.id ?? '');
  const [caption, setCaption] = useState('');
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState(false);
  const items = [...data.items, ...more];
  useEffect(() => {
    setMore([]);
    setNextBefore(data.nextBefore);
  }, [data]);
  useEffect(() => {
    if (params.get('share') === '1') {
      if (data.mine.length > 0) setOpen(true);
      else toast('Cook or write a recipe first, then share it here.');
      const next = new URLSearchParams(params);
      next.delete('share');
      setParams(next, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.get('share')]);

  async function loadMore() {
    if (!nextBefore) return;
    const r = await social.feed(data.scope, nextBefore);
    setMore((m) => [...m, ...r.items]);
    setNextBefore(r.nextBefore);
  }

  async function share() {
    if (!recipeId) return;
    setBusy(true);
    try {
      await social.createPost(recipeId, caption.trim(), attachments.map((m) => m.id));
      setOpen(false);
      setCaption('');
      setAttachments([]);
      toast('Shared');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  const firstName = (me.displayName ?? me.handle).split(' ')[0];

  return (
    <div className="feed-shell feed">
      <LeftRail mine={data.mine} />

      <main className="feed-center">
        <section className="composer" aria-label="Share something">
          <div className="composer-top">
            <Avatar name={me.displayName ?? '?'} emoji={me.avatar} />
            <button type="button" className="composer-prompt" onClick={() => (data.mine.length ? setOpen(true) : toast('Cook or write a recipe first, then share it here.'))}>
              What did you cook, {firstName}?
            </button>
          </div>
          <div className="composer-actions">
            <button type="button" className="btn btn-sm" onClick={() => setOpen(true)} disabled={data.mine.length === 0}>
              📣 Share a recipe
            </button>
            <Link to="/app/blog/new" className="btn btn-sm">
              📓 Write a blog post
            </Link>
            <Link to="/app/cook" className="btn btn-sm">
              🥘 Cook something
            </Link>
          </div>
        </section>

        <div className="feed-scope" role="tablist" aria-label="Whose posts">
          {(['everyone', 'following'] as const).map((s) => (
            <button
              key={s}
              type="button"
              role="tab"
              className="chip"
              aria-selected={data.scope === s}
              aria-pressed={data.scope === s}
              onClick={() => {
                const next = new URLSearchParams(params);
                if (s === 'everyone') next.delete('scope');
                else next.set('scope', s);
                setParams(next, { replace: true });
              }}
            >
              {s === 'everyone' ? '🌐 Everyone' : '👥 Following'}
            </button>
          ))}
        </div>

        {items.length === 0 ? (
          data.scope === 'following' ? (
            <Empty title="👥 Nothing from people you follow yet" action={<button type="button" className="btn" onClick={() => setParams({}, { replace: true })}>See everyone</button>}>
              Follow a few people from the list on the right and their recipes and posts land here.
            </Empty>
          ) : (
            <Empty
              title="🦗 Quiet in here"
              action={data.mine.length ? <button type="button" className="btn" onClick={() => setOpen(true)}>Share the first one</button> : <Link to="/app/cook" className="btn">Cook a recipe first</Link>}
            >
              Nobody has shared a recipe or written a post yet.
            </Empty>
          )
        ) : (
          <div className="stack">
            {items.map((it) => {
              switch (it.type) {
                case 'post':
                  return <PostCard key={`p-${it.post.id}`} post={it.post} onDeleted={revalidate} />;
                case 'blog':
                  return <BlogCard key={`b-${it.blog.id}`} post={it.blog} />;
                case 'book':
                  return <BookFeedCard key={`k-${it.book.id}`} book={it.book} />;
                case 'promo':
                  return <PromoCard key={`m-${it.promotion.id}`} promotion={it.promotion} />;
              }
            })}
            {nextBefore && (
              <button type="button" className="btn btn-block" onClick={loadMore}>
                Older
              </button>
            )}
          </div>
        )}
      </main>

      <RightRail people={data.people} items={items} featured={data.featured} />

      <Sheet open={open} onClose={() => setOpen(false)} title="📣 Share a recipe">
        <div className="field">
          <label htmlFor="which">Recipe</label>
          <select id="which" className="select" value={recipeId} onChange={(e) => setRecipeId(e.target.value)}>
            {data.mine.map((r) => (
              <option key={r.id} value={r.id}>
                {r.emoji} {r.title}
              </option>
            ))}
          </select>
        </div>
        <div className="field">
          <label htmlFor="caption">Caption</label>
          <textarea id="caption" className="textarea" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go? Anything you changed?" maxLength={1000} />
        </div>
        <MediaUploader compact onUploaded={(m) => setAttachments((a) => [...a, m])} label="Add a photo of how it turned out" />
        {attachments.length > 0 && (
          <div className="gallery gallery-strip">
            {attachments.map((m) => (
              <div key={m.id} className="gallery-item">
                <MediaThumb m={m} size="sm" />
                <button
                  type="button"
                  className="gallery-del"
                  aria-label="Remove"
                  onClick={async () => {
                    await mediaApi.remove(m.id).catch(() => {});
                    setAttachments((a) => a.filter((x) => x.id !== m.id));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy || !recipeId}>
            {busy ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </Sheet>
    </div>
  );
}
