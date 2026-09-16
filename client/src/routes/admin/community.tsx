import { Link, useLoaderData, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';

export async function adminCommunityLoader() {
  const [p, b, c] = await Promise.all([admin.posts(), admin.blog(), admin.comments()]);
  return { posts: p.posts, blog: b.posts, comments: c.comments };
}

export function AdminCommunity() {
  const { posts, blog, comments } = useLoaderData<typeof adminCommunityLoader>();
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
          <h1>Feed, blog & comments</h1>
          <p className="muted small">Moderation. Removing a recipe post makes its recipe private again for the author; removing a blog post takes its comments with it.</p>
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
        <h2 style={{ fontSize: 'var(--t-20)' }}>Blog posts ({blog.length})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Author</th>
                <th>Title</th>
                <th>Status</th>
                <th className="num">Likes</th>
                <th className="num">Comments</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {blog.map((p) => (
                <tr key={p.id}>
                  <td>
                    <Link to={`/admin/users/${p.authorId}`}>@{p.handle}</Link>
                  </td>
                  <td className="wrap">
                    <Link to={`/app/blog/${p.id}`}>{p.title}</Link>
                  </td>
                  <td>{p.status}</td>
                  <td className="num">{p.likeCount}</td>
                  <td className="num">{p.commentCount}</td>
                  <td>{dateTime(p.createdAt)}</td>
                  <td>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => del(() => admin.deleteBlog(p.id))}>
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              {blog.length === 0 && (
                <tr>
                  <td className="muted" colSpan={7}>
                    No blog posts yet.
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
                    <Link to={c.blogId ? `/app/blog/${c.blogId}` : `/app/posts/${c.postId}`}>{c.body}</Link>
                    {c.blogId && <span className="muted small"> · blog</span>}
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
