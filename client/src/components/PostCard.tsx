import { useState } from 'react';
import { Link } from 'react-router';
import type { Post } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { social } from '../api/types';
import { minutes, servingsLabel, timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { Avatar } from './ui';

export function PostCard({ post, detail = false, onDeleted }: { post: Post; detail?: boolean; onDeleted?: () => void }) {
  const toast = useToast();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);

  async function toggleLike() {
    const next = !liked;
    setLiked(next);
    setLikes((n) => n + (next ? 1 : -1));
    try {
      const r = await social.like(post.id, next);
      setLikes(r.likeCount);
    } catch (e) {
      setLiked(!next);
      setLikes((n) => n - (next ? 1 : -1));
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!window.confirm('Take this post down?')) return;
    try {
      await social.deletePost(post.id);
      toast('Post removed');
      onDeleted?.();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <article className="post">
      <header className="post-head">
        <Avatar name={post.author.displayName} />
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/app/u/${post.author.handle}`} className="post-author">
            {post.author.displayName}
          </Link>
          <span className="muted small">
            {' '}
            @{post.author.handle} · {timeAgo(post.createdAt)}
          </span>
        </div>
        {post.isMine && (
          <button type="button" className="btn btn-quiet btn-sm" onClick={remove}>
            Remove
          </button>
        )}
      </header>
      {post.caption && <p className="post-caption">{post.caption}</p>}
      <Link to={`/app/recipes/${post.recipe.id}`} className="post-recipe">
        <div className="stack" style={{ gap: 4 }}>
          <h3>{post.recipe.title}</h3>
          <p className="muted small">{post.recipe.summary}</p>
          <p className="muted small num">
            {minutes(post.recipe.totalMinutes)} · {servingsLabel(post.recipe.servings)} · {post.recipe.difficulty} · {post.recipe.ingredientCount} ingredients
            {post.recipe.source === 'user' ? ' · written by hand' : ''}
          </p>
        </div>
        <span className="btn btn-sm">Open</span>
      </Link>
      <footer className="post-foot">
        <button type="button" className="chip" aria-pressed={liked} onClick={toggleLike}>
          {liked ? '♥' : '♡'} {likes}
        </button>
        {detail ? (
          <span className="chip chip-static">{post.commentCount} comments</span>
        ) : (
          <Link to={`/app/posts/${post.id}`} className="chip">
            {post.commentCount} {post.commentCount === 1 ? 'comment' : 'comments'}
          </Link>
        )}
      </footer>
    </article>
  );
}
