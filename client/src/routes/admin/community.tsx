import { Link, useLoaderData, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';

export async function adminCommunityLoader() {
  const [p, c] = await Promise.all([admin.posts(), admin.comments()]);
  return { posts: p.posts, comments: c.comments };
}

export function AdminCommunity() {
  const { posts, comments } = useLoaderData<typeof adminCommunityLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  async function del(fn: () => Promise<unknown>) {
    if (!window.confirm('Remove this? The author will not be notified.')) return;
    try {
      await fn();
      toast('Removed');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Feed & comments</h1>
          <p className="muted small">Moderation. Removing a post makes its recipe private again for the author.</p>
        </div>
      </div>
      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Posts ({posts.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Author</th>
                <th>Recipe</th>
                <th>Caption</th>
                <th className="num">Likes</th>
                <th className="num">Comments</th>
                <th>Posted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/users/${p.authorId}`}>@{p.handle}</Link>
                  </td>
                  <td className="wrap">
                    <Link to={`/app/posts/${p.id}`}>{p.recipeTitle}</Link>
                  </td>
                  <td className="wrap muted">{p.caption || '—'}</td>
                  <td className="num">{p.likeCount}</td>
                  <td className="num">{p.commentCount}</td>
                  <td>{dateTime(p.createdAt)}</td>
                  <td>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => del(() => admin.deletePost(p.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {posts.length === 0 && (
                <tr>
                  <td className="muted" colSpan={7}>
                    No posts yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Comments ({comments.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Author</th>
                <th>Comment</th>
                <th>Posted</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {comments.map((c) => (
                <tr key={c.id}>
                  <td>
                    <Link to={`/admin/users/${c.authorId}`}>@{c.handle}</Link>
                  </td>
                  <td className="wrap">
                    <Link to={`/app/posts/${c.postId}`}>{c.body}</Link>
                  </td>
                  <td>{dateTime(c.createdAt)}</td>
                  <td>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => del(() => admin.deleteComment(c.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {comments.length === 0 && (
                <tr>
                  <td className="muted" colSpan={4}>
                    No comments yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
