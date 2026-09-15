import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { social } from '../../api/types';
import { PostCard } from '../../components/PostCard';
import { useToast } from '../../components/Toast';
import { Avatar } from '../../components/ui';
import { timeAgo } from '../../lib/format';
import '../../styles/social.css';

export async function postLoader({ params }: LoaderFunctionArgs) {
  return social.post(params['id']!);
}

export function PostPage() {
  const { post, comments } = useLoaderData<typeof postLoader>();
  const { revalidate } = useRevalidator();
  const nav = useNavigate();
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);

  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await social.comment(post.id, body.trim());
      setBody('');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="page-narrow stack-lg feed">
      <Link to="/app/feed" className="muted small">
        ← Feed
      </Link>
      <PostCard post={post} detail onDeleted={() => nav('/app/feed')} />
      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Comments</h2>
        {comments.length === 0 && <p className="muted small">No comments yet. Ask how it went, or say what you’d change.</p>}
        <ul className="stack" style={{ gap: 'var(--s-3)' }}>
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <Avatar name={c.author.displayName} />
              <div className="grow">
                <p className="small">
                  <Link to={`/app/u/${c.author.handle}`} className="post-author">
                    {c.author.displayName}
                  </Link>{' '}
                  <span className="muted">· {timeAgo(c.createdAt)}</span>
                </p>
                <p>{c.body}</p>
              </div>
              {(c.isMine || post.isMine) && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={async () => {
                    await social.deleteComment(c.id);
                    revalidate();
                  }}
                  aria-label="Delete comment"
                >
                  ×
                </button>
              )}
            </li>
          ))}
        </ul>
        <div className="comment-box">
          <textarea className="textarea" rows={2} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Write a comment" maxLength={500} />
          <button type="button" className="btn btn-primary" onClick={send} disabled={busy || !body.trim()}>
            Post comment
          </button>
        </div>
      </section>
    </main>
  );
}
