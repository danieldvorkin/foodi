import { useEffect, useState } from 'react';
import { Link, useLoaderData } from 'react-router';
import type { BlogPost } from '@foodi/shared';
import { auth, blog as blogApi } from '../../api/types';
import { BlogCard } from '../../components/BlogCard';
import { Empty } from '../../components/ui';
import { useMe } from './layout';
import '../../styles/social.css';

export async function blogIndexLoader() {
  const me = await auth.me();
  const [all, mine] = await Promise.all([blogApi.list(), blogApi.list({ author: me.handle })]);
  return { ...all, drafts: mine.posts.filter((p) => p.status === 'draft') };
}

export function BlogIndex() {
  const data = useLoaderData<typeof blogIndexLoader>();
  const me = useMe();
  const [more, setMore] = useState<BlogPost[]>([]);
  const [nextBefore, setNextBefore] = useState(data.nextBefore);
  useEffect(() => {
    setMore([]);
    setNextBefore(data.nextBefore);
  }, [data]);
  const posts = [...data.posts, ...more];

  return (
    <main className="page-narrow stack-lg feed">
      <header className="row-between">
        <div>
          <h1>📓 Blog</h1>
          <p className="muted">Longer stories from the kitchen: what worked, what didn’t, and the recipes behind them.</p>
        </div>
        <Link to="/app/blog/new" className="btn btn-primary">
          ✍️ Write a post
        </Link>
      </header>

      {data.drafts.length > 0 && (
        <section className="stack" style={{ gap: 'var(--s-2)' }}>
          <h2 style={{ fontSize: 'var(--t-16)' }} className="muted">
            Your drafts
          </h2>
          <ul className="rlist">
            {data.drafts.map((d) => (
              <li key={d.id} className="rlist-item">
                <div className="stack" style={{ gap: 4 }}>
                  <h3>
                    <Link to={`/app/blog/${d.id}/edit`}>{d.title}</Link>
                  </h3>
                  <p className="muted small">{d.excerpt || 'Empty draft'}</p>
                </div>
                <Link to={`/app/blog/${d.id}/edit`} className="btn btn-sm">
                  Keep writing
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      {posts.length === 0 ? (
        <Empty title="📓 Nothing published yet" action={<Link to="/app/blog/new" className="btn">Write the first post</Link>}>
          Tell people about a dish you nailed, a technique you learned, or a week of meal prep. Attach the recipes so they can cook along.
        </Empty>
      ) : (
        <div className="stack">
          {posts.map((p) => (
            <BlogCard key={p.id} post={p} />
          ))}
          {nextBefore && (
            <button
              type="button"
              className="btn btn-block"
              onClick={async () => {
                const r = await blogApi.list({ before: nextBefore });
                setMore((m) => [...m, ...r.posts]);
                setNextBefore(r.nextBefore);
              }}
            >
              Older posts
            </button>
          )}
        </div>
      )}
      <p className="hint">
        Writing as <Link to={`/app/u/${me.handle}`}>@{me.handle}</Link>. Posts you publish also appear in the feed and on your profile.
      </p>
    </main>
  );
}
