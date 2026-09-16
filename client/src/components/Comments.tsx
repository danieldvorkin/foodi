import { useState } from 'react';
import { Link } from 'react-router';
import type { Comment } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { Avatar } from './ui';

/** Comment thread + box, shared by recipe posts and blog posts. */
export function Comments({ comments, canModerate, onSend, onDelete }: { comments: Comment[]; canModerate: boolean; onSend: (body: string) => Promise<void>; onDelete: (id: string) => Promise<void> }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function send() {
    if (!body.trim()) return;
    setBusy(true);
    try {
      await onSend(body.trim());
      setBody('');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="stack">
      <h2 style={{ fontSize: 'var(--t-20)' }}>💬 Comments</h2>
      {comments.length === 0 && <p className="muted small">No comments yet. Ask how it went, or say what you’d change.</p>}
      <ul className="stack" style={{ gap: 'var(--s-3)' }}>
        {comments.map((c) => (
          <li key={c.id} className="comment">
            <Avatar name={c.author.displayName} emoji={c.author.avatar} />
            <div className="grow">
              <p className="small">
                <Link to={`/app/u/${c.author.handle}`} className="post-author">
                  {c.author.displayName}
                </Link>{' '}
                <span className="muted">· {timeAgo(c.createdAt)}</span>
              </p>
              <p>{c.body}</p>
            </div>
            {(c.isMine || canModerate) && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => onDelete(c.id).catch((e) => toast(errorMessage(e), 'error'))} aria-label="Delete comment">
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
  );
}
