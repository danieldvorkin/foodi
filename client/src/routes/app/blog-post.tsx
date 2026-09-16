import { Link, useLoaderData, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { blog as blogApi, media as mediaApi, social } from '../../api/types';
import { BlogLikeButton } from '../../components/BlogCard';
import { Comments } from '../../components/Comments';
import { MediaGallery } from '../../components/Media';
import { FollowButton } from '../../components/People';
import { Prose } from '../../components/Prose';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/ui';
import { minutes } from '../../lib/format';
import { useMe } from './layout';
import '../../styles/social.css';

export async function blogPostLoader({ params }: LoaderFunctionArgs) {
  const data = await blogApi.get(params['id']!);
  const author = await social.profile(data.post.author.handle);
  return { ...data, followedByMe: author.profile.followedByMe };
}

export function BlogPostPage() {
  const { post, comments, followedByMe } = useLoaderData<typeof blogPostLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const gallery = post.media.filter((m) => m.id !== post.cover?.id);
  const when = new Date(post.publishedAt ?? post.createdAt).toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' });

  async function remove() {
    if (!window.confirm('Delete this post? Comments go with it.')) return;
    try {
      await blogApi.remove(post.id);
      toast('Post deleted');
      nav('/app/blog', { replace: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="blog-article stack-lg feed">
      <Link to="/app/blog" className="muted small">
        ← Blog
      </Link>
      <header className="stack">
        {post.status === 'draft' && <div className="notice notice-warn">This is a draft. Only you can see it until you publish.</div>}
        <h1>{post.title}</h1>
        <p className="blog-kicker">
          {when} · {post.readingMinutes} min read
        </p>
      </header>
      {post.cover && <img className="blog-hero" src={mediaApi.url(post.cover.id)} alt="" />}
      <div className="blog-byline">
        <Link to={`/app/u/${post.author.handle}`} aria-label={post.author.displayName}>
          <Avatar name={post.author.displayName} emoji={post.author.avatar} />
        </Link>
        <div className="grow">
          <Link to={`/app/u/${post.author.handle}`} className="post-author">
            {post.author.displayName}
          </Link>
          <p className="muted small">@{post.author.handle}</p>
        </div>
        {post.isMine ? (
          <div className="row">
            <Link to={`/app/blog/${post.id}/edit`} className="btn btn-sm">
              Edit
            </Link>
            <button type="button" className="btn btn-quiet btn-sm" onClick={remove}>
              Delete
            </button>
          </div>
        ) : (
          <FollowButton handle={post.author.handle} following={followedByMe} />
        )}
        {!post.isMine && me.role === 'admin' && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={remove}>
            Remove (admin)
          </button>
        )}
      </div>

      <Prose text={post.body} />

      {gallery.length > 0 && <MediaGallery items={gallery} layout="grid" />}

      {post.recipes.length > 0 && (
        <section className="stack" style={{ gap: 'var(--s-2)' }}>
          <h2 style={{ fontSize: 'var(--t-20)' }}>🍽️ Recipes in this post</h2>
          <ul className="rlist">
            {post.recipes.map((r) => (
              <li key={r.id} className="rlist-item">
                <div className="stack" style={{ gap: 2 }}>
                  <h3>
                    <Link to={`/app/recipes/${r.id}`}>
                      {r.emoji} {r.title}
                    </Link>
                  </h3>
                  <p className="muted small">
                    ⏱ {minutes(r.totalMinutes)} · {r.difficulty}
                  </p>
                </div>
                <Link to={`/app/recipes/${r.id}`} className="btn btn-sm">
                  Open
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <div className="blog-toolbar">
        <BlogLikeButton post={post} />
        <span className="chip chip-static">💬 {comments.length}</span>
      </div>

      {post.status === 'published' && (
        <Comments
          comments={comments}
          canModerate={post.isMine || me.role === 'admin'}
          onSend={async (body) => {
            await blogApi.comment(post.id, body);
            revalidate();
          }}
          onDelete={async (id) => {
            await blogApi.deleteComment(id);
            revalidate();
          }}
        />
      )}
    </main>
  );
}
