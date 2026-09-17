import { useState, type FormEvent } from 'react';
import { Link, useLoaderData, useNavigate, type LoaderFunctionArgs } from 'react-router';
import { SHOP_CATEGORIES, SHOP_CATEGORY_EMOJI, formatMoney, type Listing, type MediaItem } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { commerce as commerceApi, media as mediaApi, shop as shopApi, type ListingInput } from '../../api/types';
import { MediaThumb, MediaUploader } from '../../components/Media';
import { useToast } from '../../components/Toast';

export async function listingEditorLoader({ params }: LoaderFunctionArgs) {
  const [config, existing] = await Promise.all([commerceApi.config(), params['id'] ? shopApi.get(params['id']).then((r) => r.listing) : Promise.resolve(null)]);
  if (existing && !existing.isMine) throw new Response('Not yours', { status: 403 });
  return { config, listing: existing };
}

function initial(l: Listing | null) {
  return {
    title: l?.title ?? '',
    description: l?.description ?? '',
    category: l?.category ?? ('other' as Listing['category']),
    condition: l?.condition ?? null,
    price: l ? (l.priceCents / 100).toFixed(2) : '',
    quantity: l?.quantity === null || !l ? '' : String(l.quantity),
    unlimited: l ? l.quantity === null : false,
    shipsFrom: l?.shipsFrom ?? '',
  };
}

export function ListingEditor() {
  const { config, listing } = useLoaderData<typeof listingEditorLoader>();
  const nav = useNavigate();
  const toast = useToast();
  const [f, setF] = useState(() => initial(listing));
  const [media, setMedia] = useState<MediaItem[]>(listing?.media ?? []);
  const [busy, setBusy] = useState<'draft' | 'submit' | null>(null);
  const cents = Math.round(Number(f.price) * 100);
  const fee = Math.round((cents * config.platformFeePercent) / 100);
  const patch = (p: Partial<typeof f>) => setF((x) => ({ ...x, ...p }));

  async function save(submit: boolean, e?: FormEvent) {
    e?.preventDefault();
    if (submit && media.length === 0) {
      toast('Add at least one photo before submitting.', 'error');
      return;
    }
    setBusy(submit ? 'submit' : 'draft');
    try {
      const body: ListingInput = {
        title: f.title.trim(),
        description: f.description.trim(),
        category: f.category,
        condition: f.condition,
        priceCents: cents,
        quantity: f.unlimited ? null : Math.max(1, Number(f.quantity) || 1),
        shipsFrom: f.shipsFrom.trim(),
        mediaIds: media.map((m) => m.id),
        submit,
      };
      const r = listing ? await shopApi.update(listing.id, body) : await shopApi.create(body);
      toast(submit ? 'Submitted for review' : 'Draft saved');
      nav(`/app/shop/${r.listing.id}`, { replace: true });
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 720 }}>
      <header className="row-between">
        <div>
          <h1>{listing ? '🛍️ Edit listing' : '🛍️ Sell something'}</h1>
          <p className="muted">A person checks every listing before it goes live, usually within a day. {listing?.status === 'approved' ? 'Edits go back through review.' : ''}</p>
        </div>
        <Link to={listing ? `/app/shop/${listing.id}` : '/app/shop'} className="btn btn-quiet btn-sm">
          Cancel
        </Link>
      </header>
      {config.testMode && <div className="notice">Test mode: buyers use a fake checkout and nobody is charged.</div>}

      <form className="stack-lg" onSubmit={(e) => save(true, e)}>
        <div className="field">
          <label htmlFor="lt">What are you selling</label>
          <input id="lt" className="input input-lg" value={f.title} onChange={(e) => patch({ title: e.target.value })} maxLength={100} placeholder="Small-batch chilli crisp, 250 ml" required minLength={3} />
        </div>
        <div className="field">
          <span className="label">Category</span>
          <div className="chips" role="radiogroup">
            {SHOP_CATEGORIES.map((c) => (
              <button key={c} type="button" role="radio" className="chip" aria-checked={f.category === c} onClick={() => patch({ category: c })}>
                {SHOP_CATEGORY_EMOJI[c]} {c}
              </button>
            ))}
          </div>
        </div>
        <div className="field">
          <label htmlFor="ld">Description</label>
          <textarea id="ld" className="textarea" value={f.description} onChange={(e) => patch({ description: e.target.value })} maxLength={5000} required minLength={10} style={{ minHeight: 160 }} placeholder="What it is, what's included, sizes, ingredients, how it ships. Light markdown works: **bold**, lists, links." />
        </div>
        <div className="editor-meta" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 'var(--s-4)' }}>
          <div className="field">
            <label htmlFor="lp">Price ({config.currency.toUpperCase()})</label>
            <input id="lp" className="input" type="number" step="0.01" min={1} max={10000} value={f.price} onChange={(e) => patch({ price: e.target.value })} required />
            {cents >= 100 && (
              <p className="hint">
                You keep {formatMoney(cents - fee)} after foodi’s {config.platformFeePercent}%.
              </p>
            )}
          </div>
          <div className="field">
            <label htmlFor="lq">Quantity</label>
            <input id="lq" className="input" type="number" min={1} max={10000} value={f.quantity} onChange={(e) => patch({ quantity: e.target.value })} disabled={f.unlimited} placeholder="1" />
            <label className="row" style={{ gap: 8, marginTop: 6 }}>
              <input type="checkbox" checked={f.unlimited} onChange={(e) => patch({ unlimited: e.target.checked })} />
              <span className="small">No limit (services, classes, digital)</span>
            </label>
          </div>
          <div className="field">
            <span className="label">Condition</span>
            <div className="chips" role="radiogroup">
              {([null, 'new', 'used'] as const).map((c) => (
                <button key={String(c)} type="button" role="radio" className="chip" aria-checked={f.condition === c} onClick={() => patch({ condition: c })}>
                  {c === null ? 'n/a' : c}
                </button>
              ))}
            </div>
          </div>
          <div className="field">
            <label htmlFor="ls">Ships from / where</label>
            <input id="ls" className="input" value={f.shipsFrom} onChange={(e) => patch({ shipsFrom: e.target.value })} maxLength={80} placeholder="Toronto · pickup or Canada Post" />
          </div>
        </div>

        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-18)' }}>📷 Photos</h2>
          <MediaUploader compact onUploaded={(m) => setMedia((xs) => (xs.length < 8 ? [...xs, m] : xs))} label="Add photos — the first one is the cover" />
          {media.length > 0 && (
            <div className="gallery gallery-strip">
              {media.map((m) => (
                <div key={m.id} className="gallery-item">
                  <MediaThumb m={m} size="sm" />
                  <button
                    type="button"
                    className="gallery-del"
                    aria-label="Remove"
                    onClick={async () => {
                      await mediaApi.remove(m.id).catch(() => {});
                      setMedia((xs) => xs.filter((x) => x.id !== m.id));
                    }}
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="row">
          <button type="submit" className="btn btn-primary btn-lg" disabled={busy !== null || cents < 100}>
            {busy === 'submit' ? 'Submitting…' : 'Submit for review'}
          </button>
          <button type="button" className="btn btn-lg" onClick={() => save(false)} disabled={busy !== null || cents < 100}>
            {busy === 'draft' ? 'Saving…' : 'Save draft'}
          </button>
        </div>
      </form>
    </main>
  );
}
