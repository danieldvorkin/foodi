import { Link, useLoaderData, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { social } from '../../api/types';
import { PostCard } from '../../components/PostCard';
import { Avatar, Empty } from '../../components/ui';
import { plural } from '../../lib/format';
import '../../styles/social.css';

export async function profileLoader({ params }: LoaderFunctionArgs) {
  return social.profile(params['handle']!);
}

export function ProfilePage() {
  const { profile, posts } = useLoaderData<typeof profileLoader>();
  const { revalidate } = useRevalidator();
  return (
    <main className="page-narrow stack-lg feed">
      <header className="profile-head">
        <Avatar name={profile.displayName} size="lg" />
        <div className="grow stack" style={{ gap: 4 }}>
          <h1>{profile.displayName}</h1>
          <p className="muted">
            @{profile.handle} · joined {new Date(profile.createdAt).toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}
          </p>
          {profile.bio && <p style={{ marginTop: 'var(--s-2)' }}>{profile.bio}</p>}
          <p className="muted small num" style={{ marginTop: 'var(--s-2)' }}>
            {plural(profile.postCount, 'post')} · {plural(profile.likeCount, 'like')} received
          </p>
        </div>
        {profile.isMe && (
          <Link to="/app/settings" className="btn btn-sm">
            Edit profile
          </Link>
        )}
      </header>
      {posts.length === 0 ? (
        <Empty title={profile.isMe ? 'You haven’t shared anything yet' : 'Nothing shared yet'}>{profile.isMe ? 'Share a recipe from its page, or from the feed.' : 'Check back later.'}</Empty>
      ) : (
        <div className="stack">
          {posts.map((p) => (
            <PostCard key={p.id} post={p} onDeleted={revalidate} />
          ))}
        </div>
      )}
    </main>
  );
}
