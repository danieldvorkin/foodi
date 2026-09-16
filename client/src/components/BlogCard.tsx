import { useState } from 'react';
import { Link } from 'react-router';
import type { BlogPost } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { blog as blogApi, media as mediaApi } from '../api/types';
import { minutes, timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { Avatar } from './ui';

export function BlogLikeButton({ post }: { post: BlogPost }) {
  const toast = useToast();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);
  async function toggle() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await blogApi.like(post.id, next);
      setLikes(r.likeCount);
    } catch (e) {
      setLiked(!next);
      setLikes((n) => n - (next ? 1 : -1));
      toast(errorMessage(e), 'error');
    }
  }
  return (
    <button type="button" className="chip" aria-pressed={liked} onClick={toggle} disabled={post.status === 'draft'}>
      {liked ? '❤️' : '🤍'} {likes}
    </button>
  );
}

/** A blog post in the feed or on a profile: kicker, title, excerpt, attached recipes. */
export function BlogCard({ post }: { post: BlogPost }) {
  return (
    <article className="blog-card">
      <header className="post-head">
        <Avatar name={post.author.displayName} emoji={post.author.avatar} />
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/app/u/${post.author.handle}`} className="post-author">
            {post.author.displayName}
          </Link>
          <span className="muted small">
            {' '}
            · 📓 blog · {timeAgo(post.publishedAt ?? post.createdAt)}
          </span>
        </div>
        {post.status === 'draft' && <span className="pill-draft">Draft</span>}
      </header>
      {post.cover && (
        <Link to={`/app/blog/${post.id}`} aria-hidden="true" tabIndex={-1}>
          <img className="blog-card-cover" src={mediaApi.url(post.cover.id)} alt="" loading="lazy" />
        </Link>
      )}
      <h2>
        <Link to={`/app/blog/${post.id}`}>{post.title}</Link>
      </h2>
      <p className="blog-excerpt">{post.excerpt}</p>
      {post.recipes.length > 0 && (
        <div className="blog-recipes">
          {post.recipes.map((r) => (
            <Link key={r.id} to={`/app/recipes/${r.id}`} className="blog-recipe-chip">
              <span aria-hidden="true">{r.emoji}</span> {r.title} <span className="muted">· {minutes(r.totalMinutes)}</span>
            </Link>
          ))}
        </div>
      )}
      <footer className="post-foot">
        <BlogLikeButton post={post} />
        <Link to={`/app/blog/${post.id}`} className="chip">
          💬 {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
        </Link>
        <span className="chip chip-static">📖 {post.readingMinutes} min read</span>
      </footer>
    </article>
  );
}
