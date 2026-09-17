import { useEffect, useState } from 'react';
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { formatMoney, type BlogPost, type Person, type Post, type RecipeBook } from '@foodi/shared';
import { media as mediaApi, social } from '../../api/types';
import { FollowButton, PeopleList } from '../../components/People';
import { useToast } from '../../components/Toast';
import { Avatar, Sheet } from '../../components/ui';
import { plural } from '../../lib/format';

export async function profileLoader({ params }: LoaderFunctionArgs) {
  const data = await social.profile(params['handle']!);
  const liked = data.profile.isMe ? await social.liked(params['handle']!).then((r) => r.posts).catch(() => [] as Post[]) : null;
  return { ...data, liked };
}

type Tab = 'posts' | 'blog' | 'books' | 'liked';

/** 1234 → "1.2k", like every social profile. */
function compact(n: number): string {
  if (n < 1000) return String(n);
  if (n < 10_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, '')}k`;
  if (n < 1_000_000) return `${Math.round(n / 1000)}k`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`;
}

function PostTile({ post }: { post: Post }) {
  const cover = post.media.find((m) => m.kind === 'image') ?? post.recipe.cover;
  return (
    <Link to={`/app/posts/${post.id}`} className={`tile${cover ? ' has-cover' : ''}`}>
      {cover ? <img src={mediaApi.url(cover.id)} alt="" loading="lazy" /> : <span className="tile-emoji" aria-hidden="true">{post.recipe.emoji}</span>}
      <span className="tile-badge">❤️ {compact(post.likeCount)}</span>
      {post.isHouse && <span className="tile-badge tile-badge-right">🥘</span>}
      <span className="tile-title">{post.recipe.title}</span>
    </Link>
  );
}

function BlogTile({ post }: { post: BlogPost }) {
  return (
    <Link to={`/app/blog/${post.id}`} className={`tile tile-blog${post.cover ? ' has-cover' : ''}`}>
      {post.cover ? <img src={mediaApi.url(post.cover.id)} alt="" loading="lazy" /> : <span className="tile-quote" aria-hidden="true">“</span>}
      <span className="tile-badge">📓 {post.readingMinutes} min</span>
      {post.status === 'draft' && <span className="tile-badge tile-badge-right">Draft</span>}
      <span className="tile-title">{post.title}</span>
    </Link>
  );
}

function BookTile({ book }: { book: RecipeBook }) {
  return (
    <Link to={`/app/books/${book.id}`} className="tile tile-book">
      <span className="tile-emoji" aria-hidden="true">
        {book.emoji}
      </span>
      {book.forSale && <span className="tile-badge">{book.purchased ? 'Owned' : formatMoney(book.priceCents)}</span>}
      {book.visibility === 'private' && <span className="tile-badge tile-badge-right">🔒</span>}
      <span className="tile-title">
        {book.name}
        <small>{plural(book.recipeCount, 'recipe')}</small>
      </span>
    </Link>
  );
}

function EmptyTab({ emoji, title, hint, action }: { emoji: string; title: string; hint?: string | undefined; action?: React.ReactNode | undefined }) {
  return (
    <div className="tile-empty">
      <span aria-hidden="true">{emoji}</span>
      <h3>{title}</h3>
      {hint && <p className="muted small">{hint}</p>}
      {action}
    </div>
  );
}

export function ProfilePage() {
  const { profile, posts, blogs, books, liked } = useLoaderData<typeof profileLoader>();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const wanted = params.get('tab');
  const tab: Tab = wanted === 'blog' ? 'blog' : wanted === 'books' ? 'books' : wanted === 'liked' && profile.isMe ? 'liked' : 'posts';
  const [followers, setFollowers] = useState(profile.followerCount);
  const [people, setPeople] = useState<{ kind: 'followers' | 'following'; list: Person[] | null } | null>(null);
  useEffect(() => setFollowers(profile.followerCount), [profile.followerCount]);

  async function openPeople(kind: 'followers' | 'following') {
    setPeople({ kind, list: null });
    const r = kind === 'followers' ? await social.followers(profile.handle) : await social.following(profile.handle);
    setPeople({ kind, list: r.people });
  }
  async function share() {
    const url = `${window.location.origin}/app/u/${profile.handle}`;
    try {
      if (navigator.share) await navigator.share({ title: `${profile.displayName} on foodi`, url });
      else {
        await navigator.clipboard.writeText(url);
        toast('Profile link copied');
      }
    } catch {
      /* dismissed */
    }
  }
  const go = (t: Tab) => {
    const next = new URLSearchParams(params);
    if (t === 'posts') next.delete('tab');
    else next.set('tab', t);
    setParams(next, { replace: true });
  };
  const joined = new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });

  const TABS: { id: Tab; label: string; icon: string; count: number }[] = [
    { id: 'posts', label: 'Posts', icon: '📣', count: posts.length },
    { id: 'blog', label: 'Blog', icon: '📓', count: blogs.length },
    { id: 'books', label: 'Books', icon: '📚', count: books.length },
    ...(profile.isMe ? [{ id: 'liked' as Tab, label: 'Liked', icon: '❤️', count: liked?.length ?? 0 }] : []),
  ];

  return (
    <main className="profile">
      <header className="profile-id">
        <Avatar name={profile.displayName} emoji={profile.avatar} size="lg" />
        <h1>{profile.displayName}</h1>
        <p className="profile-handle">
          @{profile.handle}
          {profile.followsMe && !profile.isMe ? <span className="profile-chip">follows you</span> : null}
        </p>
        <div className="profile-stats">
          <span>
            <b>{compact(profile.postCount)}</b>
            {profile.postCount === 1 ? 'post' : 'posts'}
          </span>
          <button type="button" onClick={() => openPeople('followers')}>
            <b>{compact(followers)}</b>
            {followers === 1 ? 'follower' : 'followers'}
          </button>
          <button type="button" onClick={() => openPeople('following')}>
            <b>{compact(profile.followingCount)}</b>following
          </button>
          <span>
            <b>{compact(profile.likeCount)}</b>
            {profile.likeCount === 1 ? 'like' : 'likes'}
          </span>
        </div>
        <div className="profile-actions">
          {profile.isMe ? (
            <Link to="/app/settings?tab=profile" className="btn">
              Edit profile
            </Link>
          ) : (
            <FollowButton handle={profile.handle} following={profile.followedByMe} size="md" onChange={(_f, n) => setFollowers(n)} />
          )}
          <button type="button" className="btn btn-icon" onClick={share} aria-label="Share profile" title="Share profile">
            🔗
          </button>
        </div>
        {profile.bio && <p className="profile-bio">{profile.bio}</p>}
        <p className="muted small">Cooking here since {joined}</p>
      </header>

      <div className="profile-tabs" role="tablist" aria-label="Profile sections">
        {TABS.map((t) => (
          <button key={t.id} type="button" role="tab" aria-selected={tab === t.id} onClick={() => go(t.id)}>
            <span aria-hidden="true">{t.icon}</span>
            <span className="tab-label">{t.label}</span>
            {t.count > 0 && <span className="muted num">{compact(t.count)}</span>}
          </button>
        ))}
      </div>

      {tab === 'posts' &&
        (posts.length === 0 ? (
          <EmptyTab emoji="📣" title={profile.isMe ? 'Nothing shared yet' : 'No posts yet'} hint={profile.isMe ? 'Share a recipe from its page, or from the feed.' : undefined} action={profile.isMe ? <Link to="/app?share=1" className="btn btn-sm">Share a recipe</Link> : undefined} />
        ) : (
          <div className="tiles">
            {posts.map((p) => (
              <PostTile key={p.id} post={p} />
            ))}
          </div>
        ))}

      {tab === 'blog' &&
        (blogs.length === 0 ? (
          <EmptyTab emoji="📓" title={profile.isMe ? 'No posts written yet' : `${profile.displayName} hasn’t written anything yet`} hint={profile.isMe ? 'A technique, a week of cooking, a dish you finally nailed.' : undefined} action={profile.isMe ? <Link to="/app/blog/new" className="btn btn-sm">Write a post</Link> : undefined} />
        ) : (
          <div className="tiles">
            {blogs.map((b) => (
              <BlogTile key={b.id} post={b} />
            ))}
          </div>
        ))}

      {tab === 'books' &&
        (books.length === 0 ? (
          <EmptyTab emoji="📚" title={profile.isMe ? 'No recipe books yet' : 'No public books yet'} hint={profile.isMe ? 'Collections you curate show up here.' : undefined} action={profile.isMe ? <Link to="/app/books" className="btn btn-sm">Start one</Link> : undefined} />
        ) : (
          <div className="tiles">
            {books.map((b) => (
              <BookTile key={b.id} book={b} />
            ))}
          </div>
        ))}

      {tab === 'liked' &&
        profile.isMe &&
        ((liked ?? []).length === 0 ? (
          <EmptyTab emoji="❤️" title="Nothing liked yet" hint="Only you can see this tab." />
        ) : (
          <>
            <p className="muted small" style={{ textAlign: 'center' }}>
              Only you can see what you’ve liked.
            </p>
            <div className="tiles">
              {(liked ?? []).map((p) => (
                <PostTile key={p.id} post={p} />
              ))}
            </div>
          </>
        ))}

      <Sheet open={people !== null} onClose={() => setPeople(null)} title={people?.kind === 'followers' ? plural(followers, 'follower') : 'Following'}>
        {people?.list === null ? <p className="muted small">Loading…</p> : people ? <PeopleList people={people.list} empty={people.kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'} /> : null}
      </Sheet>
    </main>
  );
}
