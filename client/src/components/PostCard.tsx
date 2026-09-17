import { useState, type FormEvent, type KeyboardEvent } from 'react';
import { Link } from 'react-router';
import type { Comment, Post } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { media as mediaApi, recipes as recipesApi, social } from '../api/types';
import { minutes, servingsLabel, timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { Avatar, Menu } from './ui';
import { MediaGallery } from './Media';

/**
 * A post in the feed: the dish first (the cook's own photo, else the recipe's cover, else its
 * emoji), the recipe underneath, then like / comment / share / save, and the conversation.
 * `detail` (the post page) shows the whole thread; the feed shows the newest two and expands.
 */
export function PostCard({ post, detail = false, comments: allComments, onDeleted }: { post: Post; detail?: boolean; comments?: Comment[]; onDeleted?: () => void }) {
  const toast = useToast();
  const [liked, setLiked] = useState(post.likedByMe);
  const [likes, setLikes] = useState(post.likeCount);
  const [thread, setThread] = useState<{ open: boolean; comments: Comment[]; total: number; full: boolean }>({
    open: detail || post.latestComments.length > 0,
    comments: allComments ?? post.latestComments,
    total: post.commentCount,
    full: Boolean(allComments),
  });
  const [loadingThread, setLoadingThread] = useState(false);
  const [saved, setSaved] = useState<string | null>(null);

  const recipeUrl = `/app/recipes/${post.recipe.id}`;
  const heroPhoto = post.media.find((m) => m.kind === 'image') ?? post.recipe.cover;
  const extraMedia = post.media.filter((m) => m !== heroPhoto);

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

  async function share() {
    const url = `${window.location.origin}${recipeUrl}`;
    const text = post.caption || post.recipe.summary;
    try {
      if (typeof navigator.share === 'function') {
        await navigator.share({ title: post.recipe.title, text, url });
        return;
      }
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast('Link copied — paste it anywhere');
    } catch {
      toast(url);
    }
  }

  async function save() {
    try {
      const r = await recipesApi.save(post.recipe.id);
      setSaved(r.id);
      toast('Saved to your recipes');
    } catch (e) {
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

  async function openThread() {
    if (thread.full) {
      setThread((t) => ({ ...t, open: true }));
      return;
    }
    setLoadingThread(true);
    try {
      const r = await social.comments(post.id);
      setThread({ open: true, comments: r.comments, total: r.comments.length, full: true });
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setLoadingThread(false);
    }
  }

  async function sendComment(body: string) {
    const r = await social.comment(post.id, body);
    setThread((t) => ({ ...t, open: true, comments: [...t.comments, r.comment], total: t.total + 1 }));
  }

  async function deleteComment(id: string) {
    try {
      await social.deleteComment(id);
      setThread((t) => ({ ...t, comments: t.comments.filter((c) => c.id !== id), total: Math.max(0, t.total - 1) }));
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  const facts = [post.recipe.difficulty, servingsLabel(post.recipe.servings), `${post.recipe.ingredientCount} ingredients`];
  const hidden = thread.total - thread.comments.length;

  return (
    <article className="post" aria-label={`${post.author.displayName}: ${post.recipe.title}`}>
      <header className="post-head">
        <Link to={`/app/u/${post.author.handle}`} className="post-avatar" aria-label={post.author.displayName}>
          <Avatar name={post.author.displayName} emoji={post.author.avatar} />
        </Link>
        <div className="post-who">
          <Link to={`/app/u/${post.author.handle}`} className="post-author">
            {post.author.displayName}
          </Link>
          <span className="muted small">
            @{post.author.handle} · {timeAgo(post.createdAt)}
          </span>
          {post.isHouse && <span className="house-pill">🥘 house recipe</span>}
        </div>
        <Menu label="More" button={<span className="iconbtn">⋯</span>}>
          <Link to={`/app/posts/${post.id}`} className="panel-item" role="menuitem">
            💬 Open post
          </Link>
          <button type="button" className="panel-item panel-item-btn" role="menuitem" onClick={share}>
            ↗ Copy link
          </button>
          {post.isMine && (
            <button type="button" className="panel-item panel-item-btn" role="menuitem" onClick={remove}>
              🗑 Remove post
            </button>
          )}
        </Menu>
      </header>

      {post.caption && <p className="post-caption">{post.caption}</p>}

      <Link to={recipeUrl} className={`post-hero${heroPhoto ? '' : ' post-hero-emoji'}`}>
        {heroPhoto ? <img src={mediaApi.url(heroPhoto.id)} alt="" loading="lazy" width={heroPhoto.width ?? undefined} height={heroPhoto.height ?? undefined} /> : <span className="post-hero-glyph" aria-hidden="true">{post.recipe.emoji}</span>}
        <span className="post-hero-title">
          <span className="post-hero-name">
            <span aria-hidden="true">{post.recipe.emoji}</span> {post.recipe.title}
          </span>
          <span className="post-hero-time num">⏱ {minutes(post.recipe.totalMinutes)}</span>
        </span>
      </Link>
      {extraMedia.length > 0 && <MediaGallery items={extraMedia} layout="strip" />}

      <div className="post-body">
        <p className="post-summary">{post.recipe.summary}</p>
        <p className="post-facts">
          {post.recipe.dietLabels.map((d) => (
            <span key={d} className="chip chip-static">
              {d}
            </span>
          ))}
          <span className="muted small">{facts.join(' · ')}</span>
        </p>
        {post.recipe.adaptedFrom && (
          <p className="muted small">
            🍴 Adapted from “{post.recipe.adaptedFrom.title}”{post.recipe.adaptedFrom.handle ? ` by @${post.recipe.adaptedFrom.handle}` : ''}
          </p>
        )}
      </div>

      <footer className="post-actions">
        <button type="button" className="post-action" aria-pressed={liked} aria-label={liked ? 'Unlike' : 'Like'} onClick={toggleLike}>
          <span aria-hidden="true">{liked ? '❤️' : '🤍'}</span> <span className="num">{likes}</span>
        </button>
        {post.commentsEnabled ? (
          <button type="button" className="post-action" aria-expanded={thread.open} aria-label={`${thread.total} ${thread.total === 1 ? 'comment' : 'comments'}`} onClick={() => (thread.open ? setThread((t) => ({ ...t, open: false })) : openThread())}>
            <span aria-hidden="true">💬</span> <span className="num">{thread.total}</span>
          </button>
        ) : (
          <span className="post-action is-off" title="Comments are off on house recipes">
            <span aria-hidden="true">💬</span> off
          </span>
        )}
        <button type="button" className="post-action" onClick={share}>
          <span aria-hidden="true">↗</span> Share
        </button>
        {!post.isMine &&
          (saved ? (
            <Link to={`/app/recipes/${saved}`} className="post-action">
              <span aria-hidden="true">✓</span> Saved
            </Link>
          ) : (
            <button type="button" className="post-action" onClick={save}>
              <span aria-hidden="true">📚</span> Save
            </button>
          ))}
        <Link to={recipeUrl} className="btn btn-primary btn-sm post-cook">
          Cook this →
        </Link>
      </footer>

      {post.commentsEnabled && thread.open && (
        <section className="post-thread" aria-label="Comments">
          {hidden > 0 && (
            <button type="button" className="post-thread-more" onClick={openThread} disabled={loadingThread}>
              {loadingThread ? 'Loading…' : `View all ${thread.total} comments`}
            </button>
          )}
          <ul className="post-comments">
            {thread.comments.map((c) => (
              <li key={c.id} className="post-comment">
                <Avatar name={c.author.displayName} emoji={c.author.avatar} />
                <div className="post-comment-body">
                  <p>
                    <Link to={`/app/u/${c.author.handle}`} className="post-author">
                      {c.author.displayName}
                    </Link>{' '}
                    <span className="muted small">· {timeAgo(c.createdAt)}</span>
                  </p>
                  <p className="post-comment-text">{c.body}</p>
                </div>
                {(c.isMine || post.isMine) && (
                  <button type="button" className="post-comment-del" onClick={() => deleteComment(c.id)} aria-label="Delete comment">
                    ×
                  </button>
                )}
              </li>
            ))}
          </ul>
          <CommentBox onSend={sendComment} />
        </section>
      )}
    </article>
  );
}

/** One line, Enter to post; Shift+Enter for a new line. */
function CommentBox({ onSend }: { onSend: (body: string) => Promise<void> }) {
  const toast = useToast();
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e?: FormEvent) {
    e?.preventDefault();
    const text = body.trim();
    if (!text || busy) return;
    setBusy(true);
    try {
      await onSend(text);
      setBody('');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }
  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void submit();
    }
  }
  return (
    <form className="post-comment-box" onSubmit={submit}>
      <textarea className="textarea" rows={1} value={body} onChange={(e) => setBody(e.target.value)} onKeyDown={onKey} placeholder="Add a comment…" maxLength={500} aria-label="Add a comment" />
      <button type="submit" className="btn btn-sm btn-primary" disabled={busy || !body.trim()}>
        Post
      </button>
    </form>
  );
}
