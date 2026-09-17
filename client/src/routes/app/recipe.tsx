import { useState } from 'react';
import { Link, useLoaderData, useLocation, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { MEAL_EMOJI, type MediaItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { media as mediaApi, recipes as recipesApi, social as socialApi } from '../../api/types';
import { AddToBook } from '../../components/Books';
import { AddToList } from '../../components/AddToList';
import { isActive, upsertJob, useJobs } from '../../lib/jobs';
import { useMe } from './layout';
import { MediaGallery, MediaThumb, MediaUploader } from '../../components/Media';
import { IngredientList, StepList } from '../../components/RecipeParts';
import { useToast } from '../../components/Toast';
import { Meta, Sheet } from '../../components/ui';
import { minutes, servingsLabel } from '../../lib/format';

export async function recipeLoader({ params }: LoaderFunctionArgs) {
  return recipesApi.get(params['id']!);
}

export function RecipePage() {
  const data = useLoaderData<typeof recipeLoader>();
  const { recipe, isMine, source, visibility, author } = data;
  const c = recipe.content;
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const [checked, setChecked] = useState<Set<number>>(new Set());
  const [tweak, setTweak] = useState('');
  const [tweakOpen, setTweakOpen] = useState(false);
  const location = useLocation();
  const [shareOpen, setShareOpen] = useState(Boolean((location.state as { share?: boolean } | null)?.share));
  const [photosOpen, setPhotosOpen] = useState(false);
  const [bookOpen, setBookOpen] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const me = useMe();
  const jobs = useJobs();
  const photoJob = jobs.find((j) => j.kind === 'image' && j.recipeId === recipe.id);
  const photoInFlight = Boolean(photoJob && isActive(photoJob));
  const cover = recipe.media[0] ?? null;
  const hasUpload = recipe.media.some((m) => m.kind === 'image' && !m.generated);
  // Auto photos other than the cover stay out of the hero: they are the owner's "tried" strip.
  const heroItems = recipe.media.filter((m) => !m.generated || m.id === cover?.id);
  const autoPhotos = recipe.media.filter((m) => m.generated);
  const canAutoPhoto = isMine && !recipe.adaptedFrom && !hasUpload;
  const canMakePhoto = canAutoPhoto && me.aiCapabilities.images;
  const [shuffling, setShuffling] = useState(false);
  // A finished photo job means the loader data is stale until we revalidate.
  const [seenPhotoJob, setSeenPhotoJob] = useState<string | null>(null);
  if (photoJob && photoJob.status === 'done' && seenPhotoJob !== `${photoJob.id}:done`) {
    setSeenPhotoJob(`${photoJob.id}:done`);
    queueMicrotask(revalidate);
  }
  const [caption, setCaption] = useState('');
  const [attachments, setAttachments] = useState<MediaItem[]>([]);
  const [busy, setBusy] = useState<'' | 'tweak' | 'share' | 'random'>('');

  const toggle = (i: number) =>
    setChecked((s) => {
      const n = new Set(s);
      if (n.has(i)) n.delete(i);
      else n.add(i);
      return n;
    });

  async function doTweak() {
    if (!tweak.trim()) return;
    setBusy('tweak');
    try {
      const { job } = await recipesApi.generate({ prompt: tweak.trim(), ingredientIds: [], basedOnRecipeId: recipe.id });
      upsertJob(job);
      setTweakOpen(false);
      setTweak('');
      toast('Writing the new version — it’ll show up in Cook and in your notifications.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }

  /** Same request, a different dish. */
  async function randomize() {
    setBusy('random');
    try {
      const { job } = await recipesApi.generate({
        prompt: recipe.prompt,
        ingredientIds: recipe.requestedIngredientIds,
        mealType: c.mealType,
        avoidTitles: [c.title],
        seed: Math.random().toString(36).slice(2, 10),
      });
      upsertJob(job);
      toast('Rolling a new one 🎲 — it’ll show up in Cook and in your notifications.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function share() {
    setBusy('share');
    try {
      await socialApi.createPost(recipe.id, caption.trim(), attachments.map((m) => m.id));
      setShareOpen(false);
      setAttachments([]);
      toast('Shared to the feed');
      nav('/app');
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setBusy('');
    }
  }

  async function save() {
    try {
      const { id } = await recipesApi.save(recipe.id);
      toast('Saved to your recipes ⭐');
      nav(`/app/recipes/${id}`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  /** An editable copy that credits the original; lands in the editor so notes can be written. */
  async function adapt() {
    try {
      const { id } = await recipesApi.adapt(recipe.id);
      toast('Copied — make it yours 🍴');
      nav(`/app/recipes/${id}/edit?adapted=1`);
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function remove() {
    if (!window.confirm('Delete this recipe? This can’t be undone.')) return;
    try {
      await recipesApi.remove(recipe.id);
      nav('/app/cook');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function deleteMedia(m: MediaItem) {
    try {
      await mediaApi.remove(m.id);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function makePhoto() {
    try {
      const { job } = await recipesApi.photo(recipe.id);
      upsertJob(job);
      toast('Making a photo — about a minute.');
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  async function shufflePhoto() {
    setShuffling(true);
    try {
      await recipesApi.shufflePhoto(recipe.id);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    } finally {
      setShuffling(false);
    }
  }

  async function pickCover(m: MediaItem) {
    if (m.id === cover?.id) return;
    try {
      await recipesApi.setCover(recipe.id, m.id);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <main className="page recipe">
      {(photoInFlight || shuffling) && recipe.media.length === 0 && (
        <section className="recipe-hero">
          <div className="photo-shimmer" role="status" aria-live="polite">
            <span className="spinner" />{' '}
            {shuffling ? 'Finding a photo of your dish…' : photoJob?.status === 'queued' && photoJob.attempts > 0 ? 'First photo didn’t pass the check — trying once more…' : me.aiCapabilities.images ? 'Photographing your dish…' : 'Finding a photo of your dish…'}
          </div>
        </section>
      )}
      {!photoInFlight && !shuffling && recipe.media.length === 0 && canAutoPhoto && (
        <section className="recipe-hero">
          <div className="photo-empty">
            <span className="photo-empty-emoji" aria-hidden="true">
              {c.emoji}
            </span>
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <p className="muted">No photo yet.</p>
              <div className="row">
                <button type="button" className="btn btn-primary btn-sm" onClick={shufflePhoto}>
                  🎲 Find a photo
                </button>
                {canMakePhoto && (
                  <button type="button" className="btn btn-sm" onClick={makePhoto}>
                    ✨ Generate with AI
                  </button>
                )}
                <button type="button" className="btn btn-sm" onClick={() => setPhotosOpen(true)}>
                  📷 Add your own
                </button>
              </div>
            </div>
          </div>
        </section>
      )}
      {recipe.media.length > 0 && (
        <section className="recipe-hero">
          <MediaGallery items={heroItems} layout="hero" {...(isMine ? { onDelete: deleteMedia } : {})} />
          <div className="photo-bar">
            {cover && <PhotoCredit m={cover} />}
            {canAutoPhoto && (
              <div className="row photo-bar-actions">
                <button type="button" className="btn btn-sm" onClick={shufflePhoto} disabled={shuffling || photoInFlight}>
                  {shuffling ? (
                    <>
                      <span className="spinner" /> Finding a photo…
                    </>
                  ) : (
                    '🎲 Try another photo'
                  )}
                </button>
                {canMakePhoto && (
                  <button type="button" className="btn btn-sm" onClick={makePhoto} disabled={photoInFlight || shuffling}>
                    {photoInFlight ? '✨ Photographing…' : '✨ Generate with AI'}
                  </button>
                )}
                {cover?.generated && (
                  <button type="button" className="btn btn-quiet btn-sm" onClick={() => deleteMedia(cover)} disabled={shuffling}>
                    🗑 Remove this photo
                  </button>
                )}
              </div>
            )}
          </div>
          {isMine && autoPhotos.length > 1 && (
            <div className="photo-strip" role="group" aria-label="Photos tried for this recipe">
              {autoPhotos.map((m) => (
                <span key={m.id} className="photo-strip-cell">
                  <button type="button" className="photo-strip-item" aria-pressed={m.id === cover?.id} onClick={() => pickCover(m)} title={m.id === cover?.id ? 'Current cover' : 'Use this photo'}>
                    <img src={mediaApi.url(m.id)} alt="" loading="lazy" />
                  </button>
                  <button type="button" className="photo-strip-del" onClick={() => deleteMedia(m)} aria-label="Delete this photo">
                    ×
                  </button>
                </span>
              ))}
              <span className="muted tiny">Tap one to use it as the cover; × deletes it.</span>
            </div>
          )}
        </section>
      )}

      <header className="recipe-head">
        <div className="stack">
          {author && !isMine && (
            <p className="muted small">
              {author.avatar} By <Link to={`/app/u/${author.handle}`}>{author.displayName}</Link>
            </p>
          )}
          {recipe.adaptedFrom && (
            <div className="lineage">
              <span aria-hidden="true">🍴</span>
              <div>
                Adapted from{' '}
                {recipe.adaptedFrom.id && recipe.adaptedFrom.stillPublic ? <Link to={`/app/recipes/${recipe.adaptedFrom.id}`}><b>{recipe.adaptedFrom.title}</b></Link> : <b>{recipe.adaptedFrom.title}</b>}
                {recipe.adaptedFrom.handle && (
                  <>
                    {' '}
                    by <Link to={`/app/u/${recipe.adaptedFrom.handle}`}>@{recipe.adaptedFrom.handle}</Link>
                  </>
                )}
                {!recipe.adaptedFrom.stillPublic && <span className="muted"> (no longer shared)</span>}
                {recipe.revisionNotes && (
                  <p className="lineage-notes">
                    <b>What changed:</b> {recipe.revisionNotes}
                  </p>
                )}
              </div>
            </div>
          )}
          {recipe.adaptationCount > 0 && (
            <p className="muted small">
              🍴 Adapted by {recipe.adaptationCount} {recipe.adaptationCount === 1 ? 'person' : 'people'}
            </p>
          )}
          <div className="recipe-title">
            {recipe.media.length === 0 && (
              <span className="emoji-tile emoji-tile-lg" aria-hidden="true">
                {c.emoji}
              </span>
            )}
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <h1>
                {recipe.media.length > 0 && <span aria-hidden="true">{c.emoji} </span>}
                {c.title}
              </h1>
              <p className="lede-sm measure">{c.summary}</p>
            </div>
          </div>
          <Meta
            items={[
              { value: `⏱ ${minutes(c.totalMinutes)}`, label: 'total' },
              { value: minutes(c.activeMinutes), label: 'hands-on' },
              `👥 ${servingsLabel(c.servings)}`,
              `${MEAL_EMOJI[c.mealType]} ${c.mealType}`,
              c.difficulty,
              ...(c.cuisine ? [c.cuisine] : []),
            ]}
          />
          {(c.dietLabels.length > 0 || c.tags.length > 0) && (
            <div className="badges">
              {c.dietLabels.map((d) => (
                <span key={d} className="chip chip-static chip-sage">
                  {d}
                </span>
              ))}
              {c.tags.map((t) => (
                <span key={t} className="chip chip-static">
                  {t}
                </span>
              ))}
            </div>
          )}
          {recipe.warnings.length > 0 && (
            <div className="notice notice-warn" role="alert">
              ⚠️ Contains {recipe.warnings.join(', ')} — which you told us you can’t eat. Check the ingredients before cooking.
            </div>
          )}
        </div>
        <div className="recipe-actions">
          <Link to={`/cook/${recipe.id}`} className="btn btn-primary btn-lg">
            👩‍🍳 Start cooking
          </Link>
          {isMine ? (
            <>
              <span className="recipe-actions-sep" aria-hidden="true" />
              {source === 'ai' && (
                <button type="button" className="btn" onClick={randomize} disabled={busy !== ''}>
                  {busy === 'random' ? '🎲 Rolling…' : '🎲 Randomize'}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setTweakOpen(true)}>
                ✏️ Adjust with AI
              </button>
              {source === 'user' && (
                <Link to={`/app/recipes/${recipe.id}/edit`} className="btn">
                  📝 Edit by hand
                </Link>
              )}
              <button type="button" className="btn" onClick={() => setPhotosOpen((o) => !o)} aria-expanded={photosOpen}>
                📷 {recipe.media.length ? 'Add more photos' : 'Add photos'}
              </button>
              <span className="recipe-actions-sep" aria-hidden="true" />
              <button type="button" className="btn" onClick={() => setShareOpen(true)}>
                📣 {visibility === 'public' ? 'Share again' : 'Share to the feed'}
              </button>
              <button type="button" className="btn" onClick={() => setBookOpen(true)}>
                📚 Add to a book
              </button>
              <button type="button" className="btn" onClick={() => setListOpen(true)}>
                🛒 Add to shopping list
              </button>
              <button
                type="button"
                className="btn"
                aria-pressed={recipe.favorite}
                onClick={async () => {
                  await recipesApi.favorite(recipe.id, !recipe.favorite);
                  revalidate();
                }}
              >
                {recipe.favorite ? '⭐ Favourited' : '☆ Favourite'}
              </button>
              <span className="recipe-actions-sep" aria-hidden="true" />
              <button type="button" className="btn btn-quiet" onClick={remove}>
                🗑 Delete recipe
              </button>
            </>
          ) : (
            <>
              <span className="recipe-actions-sep" aria-hidden="true" />
              <button type="button" className="btn" onClick={adapt} title="Make an editable copy that credits the original">
                🍴 Adapt this recipe
              </button>
              <button type="button" className="btn" onClick={save}>
                ⭐ Save a copy
              </button>
              <button type="button" className="btn" onClick={() => setBookOpen(true)}>
                📚 Add to a book
              </button>
              <button type="button" className="btn" onClick={() => setListOpen(true)}>
                🛒 Add to shopping list
              </button>
            </>
          )}
        </div>
      </header>
      <AddToBook recipeId={recipe.id} open={bookOpen} onClose={() => setBookOpen(false)} />
      {listOpen && <AddToList recipeId={recipe.id} title={c.title} ingredients={c.ingredients} servings={c.servings} open onClose={() => setListOpen(false)} />}

      {photosOpen && isMine && (
        <section className="recipe-photos">
          <MediaUploader
            recipeId={recipe.id}
            onUploaded={() => {
              toast('Photo added');
              revalidate();
            }}
            label="Add photos or a short video of this dish"
          />
        </section>
      )}

      <div className="recipe-body">
        <section className="recipe-ings">
          <div className="section-head">
            <h2>🧺 Ingredients</h2>
            {checked.size > 0 && (
              <button type="button" className="btn btn-quiet btn-sm" onClick={() => setChecked(new Set())}>
                Uncheck all
              </button>
            )}
          </div>
          <IngredientList ingredients={c.ingredients} checked={checked} onToggle={toggle} warnings={recipe.warnings} />
          {c.equipment.length > 0 && (
            <div className="stack" style={{ marginTop: 'var(--s-5)', gap: 'var(--s-2)' }}>
              <h4>🍳 You’ll need</h4>
              <p className="muted small">{c.equipment.join(', ')}</p>
            </div>
          )}
          {c.substitutions.length > 0 && (
            <div className="stack" style={{ marginTop: 'var(--s-5)', gap: 'var(--s-2)' }}>
              <h4>🔁 Swaps</h4>
              <ul className="small muted stack" style={{ gap: 4 }}>
                {c.substitutions.map((s, i) => (
                  <li key={i}>
                    <b style={{ color: 'var(--ink)', fontWeight: 500 }}>{s.ingredient}</b> → {s.swap}
                    {s.why ? ` (${s.why})` : ''}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </section>

        <section className="recipe-steps">
          <div className="section-head">
            <h2>👣 Steps</h2>
            <span className="muted small">{c.steps.length} steps</span>
          </div>
          <StepList steps={c.steps} ingredients={c.ingredients} />
          {(c.makeAhead || c.storage || c.nutritionPerServing) && (
            <div className="recipe-notes">
              {c.makeAhead && (
                <p>
                  <b>📅 Make ahead.</b> {c.makeAhead}
                </p>
              )}
              {c.storage && (
                <p>
                  <b>🧊 Leftovers.</b> {c.storage}
                </p>
              )}
              {c.nutritionPerServing && (
                <p className="muted small">
                  Per serving, roughly: {Math.round(c.nutritionPerServing.calories)} kcal · {Math.round(c.nutritionPerServing.proteinGrams)} g protein ·{' '}
                  {Math.round(c.nutritionPerServing.carbsGrams)} g carbs · {Math.round(c.nutritionPerServing.fatGrams)} g fat
                </p>
              )}
            </div>
          )}
          {recipe.prompt && (
            <p className="muted small" style={{ marginTop: 'var(--s-5)' }}>
              Written from: “{recipe.prompt}” · {recipe.provider === 'mock' ? 'mock chef' : recipe.model}
            </p>
          )}
        </section>
      </div>

      <Sheet open={tweakOpen} onClose={() => setTweakOpen(false)} title="✏️ Adjust this recipe">
        <p className="muted small">Say what to change. You’ll get a new version; this one stays.</p>
        <div className="chips">
          {['Make it vegan', 'Halve it', 'Double it', 'Less spicy', 'Faster', 'Swap the protein'].map((t) => (
            <button key={t} type="button" className="chip" onClick={() => setTweak(t)}>
              {t}
            </button>
          ))}
        </div>
        <textarea className="textarea" value={tweak} onChange={(e) => setTweak(e.target.value)} placeholder="e.g. no oven — stovetop only" maxLength={500} />
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={doTweak} disabled={busy !== '' || !tweak.trim()}>
            {busy === 'tweak' ? 'Rewriting…' : 'Rewrite'}
          </button>
        </div>
      </Sheet>

      <Sheet open={shareOpen} onClose={() => setShareOpen(false)} title="📣 Share to the feed">
        <p className="muted small">Everyone signed in to this foodi can see it and save it. You can take it down any time.</p>
        <textarea className="textarea" value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="How did it go? Anything you changed?" maxLength={1000} />
        <MediaUploader compact onUploaded={(m) => setAttachments((a) => [...a, m])} label="Add a photo of how it turned out" />
        {attachments.length > 0 && (
          <div className="gallery gallery-strip">
            {attachments.map((m) => (
              <div key={m.id} className="gallery-item">
                <MediaThumb m={m} size="sm" />
                <button
                  type="button"
                  className="gallery-del"
                  aria-label="Remove"
                  onClick={async () => {
                    await mediaApi.remove(m.id).catch(() => {});
                    setAttachments((a) => a.filter((x) => x.id !== m.id));
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
        )}
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={share} disabled={busy !== ''}>
            {busy === 'share' ? 'Sharing…' : 'Share'}
          </button>
        </div>
      </Sheet>
    </main>
  );
}

/** Who took the cover photo. AI photos say so; library photos credit the author and licence. */
function PhotoCredit({ m }: { m: MediaItem }) {
  if (!m.generated) return null;
  if (m.source === 'ai') return <p className="hint photo-credit">✨ AI photo, checked against the recipe before it was shown.</p>;
  const label =
    m.source === 'pexels' ? `Photo by ${m.credit ?? 'a Pexels photographer'} on Pexels`
    : m.source === 'google' ? `Photo: ${m.credit ?? 'found on the web'}`
    : `Photo: ${m.credit ?? 'Wikimedia Commons'}${m.license ? ` · ${m.license}` : ''} · Wikimedia Commons`;
  return (
    <p className="hint photo-credit">
      📷{' '}
      {m.sourceUrl ? (
        <a href={m.sourceUrl} target="_blank" rel="noopener noreferrer">
          {label}
        </a>
      ) : (
        label
      )}
    </p>
  );
}
