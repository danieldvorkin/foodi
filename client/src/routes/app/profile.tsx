import { useEffect, useState } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import type { Person } from '@foodi/shared';
import { social } from '../../api/types';
import { BlogCard } from '../../components/BlogCard';
import { BookCard } from '../../components/Books';
import { FollowButton, PeopleList } from '../../components/People';
import { PostCard } from '../../components/PostCard';
import { Avatar, Empty, Sheet } from '../../components/ui';
import { plural } from '../../lib/format';

export async function profileLoader({ params }: LoaderFunctionArgs) {
  return social.profile(params['handle']!);
}

type Tab = 'posts' | 'blog' | 'books';

export function ProfilePage() {
  const { profile, posts, blogs, books } = useLoaderData<typeof profileLoader>();
  const { revalidate } = useRevalidator();
  const [params, setParams] = useSearchParams();
  const tab: Tab = params.get('tab') === 'blog' ? 'blog' : params.get('tab') === 'books' ? 'books' : 'posts';
  const [followers, setFollowers] = useState(profile.followerCount);
  const [people, setPeople] = useState<{ kind: 'followers' | 'following'; list: Person[] | null } | null>(null);
  useEffect(() => setFollowers(profile.followerCount), [profile.followerCount]);

  async function openPeople(kind: 'followers' | 'following') {
    setPeople({ kind, list: null });
    const r = kind === 'followers' ? await social.followers(profile.handle) : await social.following(profile.handle);
    setPeople({ kind, list: r.people });
  }

  const joined = new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' });

  return (
    <main className="page-narrow stack-lg feed" style={{ maxWidth: 820 }}>
      <header className="profile-head">
        <Avatar name={profile.displayName} emoji={profile.avatar} size="lg" />
        <div className="grow stack" style={{ gap: 6, minWidth: 0 }}>
          <h1>{profile.displayName}</h1>
          <p className="muted">
            @{profile.handle} · joined {joined}
            {profile.followsMe && !profile.isMe ? ' · follows you' : ''}
          </p>
          {profile.bio && <p style={{ marginTop: 'var(--s-1)' }}>{profile.bio}</p>}
          <div className="profile-stats num">
            <button type="button" onClick={() => openPeople('followers')}>
              <b>{followers}</b> {followers === 1 ? 'follower' : 'followers'}
            </button>
            <button type="button" onClick={() => openPeople('following')}>
              <b>{profile.followingCount}</b> following
            </button>
            <span>
              <b>{profile.postCount}</b> {profile.postCount === 1 ? 'post' : 'posts'}
            </span>
            <span>
              <b>{profile.likeCount}</b> {profile.likeCount === 1 ? 'like' : 'likes'} received
            </span>
          </div>
        </div>
        {profile.isMe ? (
          <Link to="/app/settings?tab=profile" className="btn btn-sm">
            Edit profile
          </Link>
        ) : (
          <FollowButton handle={profile.handle} following={profile.followedByMe} size="md" onChange={(_f, n) => setFollowers(n)} />
        )}
      </header>

      <div className="profile-tabs" role="tablist" aria-label="Profile sections">
        {(
          [
            ['posts', `📣 Posts · ${posts.length}`],
            ['blog', `📓 Blog · ${blogs.length}`],
            ['books', `📚 Recipe books · ${books.length}`],
          ] as const
        ).map(([t, label]) => (
          <button
            key={t}
            type="button"
            role="tab"
            aria-selected={tab === t}
            onClick={() => {
              const next = new URLSearchParams(params);
              if (t === 'posts') next.delete('tab');
              else next.set('tab', t);
              setParams(next, { replace: true });
            }}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'posts' &&
        (posts.length === 0 ? (
          <Empty title={profile.isMe ? 'You haven’t shared anything yet' : 'Nothing shared yet'}>{profile.isMe ? 'Share a recipe from its page, or from the feed.' : 'Check back later.'}</Empty>
        ) : (
          <div className="stack">
            {posts.map((p) => (
              <PostCard key={p.id} post={p} onDeleted={revalidate} />
            ))}
          </div>
        ))}

      {tab === 'blog' &&
        (blogs.length === 0 ? (
          <Empty title={profile.isMe ? 'No posts yet' : `${profile.displayName} hasn’t written anything yet`} action={profile.isMe ? <Link to="/app/blog/new" className="btn">Write a post</Link> : undefined}>
            {profile.isMe ? 'Longer stories go here — a technique, a week of cooking, a dish you finally nailed.' : ''}
          </Empty>
        ) : (
          <div className="stack">
            {blogs.map((b) => (
              <BlogCard key={b.id} post={b} />
            ))}
          </div>
        ))}

      {tab === 'books' &&
        (books.length === 0 ? (
          <Empty title={profile.isMe ? 'No recipe books yet' : 'No public books yet'} action={profile.isMe ? <Link to="/app/books" className="btn">Start one</Link> : undefined}>
            {profile.isMe ? 'Collections you curate show up here. Private ones only you can see.' : ''}
          </Empty>
        ) : (
          <div className="book-grid">
            {books.map((b) => (
              <BookCard key={b.id} book={b} />
            ))}
          </div>
        ))}

      <Sheet open={people !== null} onClose={() => setPeople(null)} title={people?.kind === 'followers' ? `${plural(followers, 'follower')}` : 'Following'}>
        {people?.list === null ? <p className="muted small">Loading…</p> : people ? <PeopleList people={people.list} empty={people.kind === 'followers' ? 'No followers yet.' : 'Not following anyone yet.'} /> : null}
      </Sheet>
    </main>
  );
}
