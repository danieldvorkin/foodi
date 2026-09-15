import { useState } from 'react';
import { Link, useLoaderData, useLocation, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { MEAL_EMOJI, type MediaItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { media as mediaApi, recipes as recipesApi, social as socialApi } from '../../api/types';
import { MediaGallery, MediaThumb, MediaUploader } from '../../components/Media';
import { IngredientList, StepList } from '../../components/RecipeParts';
import { useToast } from '../../components/Toast';
import { Meta, Sheet } from '../../components/ui';
import { minutes, servingsLabel } from '../../lib/format';
import '../../styles/recipe.css';

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
      const { recipe: next } = await recipesApi.generate({ prompt: tweak.trim(), ingredientIds: [], basedOnRecipeId: recipe.id });
      setTweakOpen(false);
      nav(`/app/recipes/${next.id}`);
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
      const { recipe: next } = await recipesApi.generate({
        prompt: recipe.prompt,
        ingredientIds: recipe.requestedIngredientIds,
        mealType: c.mealType,
        avoidTitles: [c.title],
        seed: Math.random().toString(36).slice(2, 10),
      });
      toast('Rolled a new one 🎲');
      nav(`/app/recipes/${next.id}`);
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
      nav('/app/feed');
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

  async function remove() {
    if (!window.confirm('Delete this recipe? This can’t be undone.')) return;
    try {
      await recipesApi.remove(recipe.id);
      nav('/app');
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

  return (
    <main className="page recipe">
      {recipe.media.length > 0 && (
        <section className="recipe-hero">
          <MediaGallery items={recipe.media} layout="hero" {...(isMine ? { onDelete: deleteMedia } : {})} />
        </section>
      )}

      <header className="recipe-head">
        <div className="stack">
          {author && !isMine && (
            <p className="muted small">
              {author.avatar} By <Link to={`/app/u/${author.handle}`}>{author.displayName}</Link>
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
              {source === 'ai' && (
                <button type="button" className="btn" onClick={randomize} disabled={busy !== ''}>
                  {busy === 'random' ? 'Rolling…' : '🎲 Randomize'}
                </button>
              )}
              <button type="button" className="btn" onClick={() => setTweakOpen(true)}>
                ✏️ Adjust
              </button>
              <button type="button" className="btn" onClick={() => setPhotosOpen((o) => !o)} aria-expanded={photosOpen}>
                📷 {recipe.media.length ? 'Add more photos' : 'Add photos'}
              </button>
              <button type="button" className="btn" onClick={() => setShareOpen(true)}>
                📣 {visibility === 'public' ? 'Share again' : 'Share'}
              </button>
              {source === 'user' && (
                <Link to={`/app/recipes/${recipe.id}/edit`} className="btn">
                  Edit
                </Link>
              )}
              <button
                type="button"
                className="btn btn-quiet"
                aria-pressed={recipe.favorite}
                onClick={async () => {
                  await recipesApi.favorite(recipe.id, !recipe.favorite);
                  revalidate();
                }}
              >
                {recipe.favorite ? '⭐ Favorite' : '☆ Favorite'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={remove}>
                Delete
              </button>
            </>
          ) : (
            <button type="button" className="btn" onClick={save}>
              ⭐ Save to my recipes
            </button>
          )}
        </div>
      </header>

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
