import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { formatMoney, type CommerceConfig, type PromoPackageId, type Promotion, type RecipeBook } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { commerce as commerceApi, type SaleInput } from '../api/types';
import { plural, timeAgo } from '../lib/format';
import { useToast } from './Toast';
import { Avatar, Sheet } from './ui';

/** "Buy for $X" — starts a checkout and sends the browser there. */
export function BuyButton({ book, size = 'md' }: { book: RecipeBook; size?: 'sm' | 'md' | 'lg' }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  async function buy() {
    setBusy(true);
    try {
      const { url } = await commerceApi.buy(book.id);
      window.location.assign(url);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }
  return (
    <button type="button" className={`btn btn-primary ${size === 'sm' ? 'btn-sm' : size === 'lg' ? 'btn-lg' : ''}`} onClick={buy} disabled={busy}>
      {busy ? 'Opening checkout…' : `Buy for ${formatMoney(book.priceCents)}`}
    </button>
  );
}

/** Owner: put the book up for sale, set a price, pitch and preview. */
export function SellSheet({ book, config, open, onClose, onSaved }: { book: RecipeBook; config: CommerceConfig; open: boolean; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [forSale, setForSale] = useState(book.forSale);
  const [price, setPrice] = useState(book.priceCents ? (book.priceCents / 100).toFixed(2) : '4.99');
  const [pitch, setPitch] = useState(book.salesPitch);
  const [preview, setPreview] = useState(book.previewCount);
  const [busy, setBusy] = useState(false);
  const cents = Math.round(Number(price) * 100);
  const fee = Math.round((cents * config.platformFeePercent) / 100);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      const body: SaleInput = { forSale, priceCents: cents, salesPitch: pitch.trim(), previewCount: preview };
      await commerceApi.setSale(book.id, body);
      toast(forSale ? `On sale for ${formatMoney(cents)}` : 'Taken off sale');
      onSaved();
      onClose();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Sheet open={open} onClose={onClose} title="💵 Sell this book">
      <form className="stack" onSubmit={submit}>
        {config.testMode && <div className="notice">Test mode: checkouts complete on a fake page and nobody is charged. Connect Stripe to sell for real.</div>}
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={forSale} onChange={(e) => setForSale(e.target.checked)} />
          <span>Put this book up for sale</span>
        </label>
        <div className="field">
          <label htmlFor="price">Price ({config.currency.toUpperCase()})</label>
          <input id="price" className="input" type="number" step="0.01" min={config.minPriceCents / 100} max={config.maxPriceCents / 100} value={price} onChange={(e) => setPrice(e.target.value)} style={{ maxWidth: 160 }} />
          <p className="hint">
            {cents >= config.minPriceCents && cents <= config.maxPriceCents ? (
              <>
                foodi keeps {config.platformFeePercent}% ({formatMoney(fee)}); you earn <b>{formatMoney(cents - fee)}</b> per sale.
              </>
            ) : (
              `Between ${formatMoney(config.minPriceCents)} and ${formatMoney(config.maxPriceCents)}.`
            )}
          </p>
        </div>
        <div className="field">
          <label htmlFor="pitch">Why buy it</label>
          <textarea id="pitch" className="textarea" value={pitch} onChange={(e) => setPitch(e.target.value)} maxLength={600} placeholder="What's inside, who it's for, what makes it worth it" style={{ minHeight: 90 }} />
        </div>
        <div className="field">
          <label htmlFor="preview">Free preview</label>
          <select id="preview" className="select" value={preview} onChange={(e) => setPreview(Number(e.target.value))} style={{ maxWidth: 220 }}>
            {[0, 1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>
                {n === 0 ? 'No preview' : `First ${plural(n, 'recipe')} free`}
              </option>
            ))}
          </select>
          <p className="hint">Browsers can open these before paying. The rest show titles only. Every recipe must be your own.</p>
        </div>
        <div className="row">
          <button type="submit" className="btn btn-primary" disabled={busy || (forSale && (cents < config.minPriceCents || cents > config.maxPriceCents))}>
            {busy ? 'Saving…' : forSale ? 'Save and list' : 'Save'}
          </button>
        </div>
      </form>
    </Sheet>
  );
}

/** Owner: buy a promotion package. */
export function PromoteSheet({ book, config, open, onClose }: { book: RecipeBook; config: CommerceConfig; open: boolean; onClose: () => void }) {
  if (book.promoted) {
    return (
      <Sheet open={open} onClose={onClose} title="🚀 Already promoted">
        <p className="muted">This book is in the feed and the Featured rail right now. You can buy another package once this one ends — see the end date on your sales page.</p>
        <div className="row">
          <Link to="/app/sales" className="btn btn-primary" onClick={onClose}>
            Sales & payouts
          </Link>
          <button type="button" className="btn btn-quiet" onClick={onClose}>
            Close
          </button>
        </div>
      </Sheet>
    );
  }
  return <PromotePicker book={book} config={config} open={open} onClose={onClose} />;
}

function PromotePicker({ book, config, open, onClose }: { book: RecipeBook; config: CommerceConfig; open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [pick, setPick] = useState<PromoPackageId>(config.packages[1]?.id ?? config.packages[0]!.id);
  const [busy, setBusy] = useState(false);
  async function go() {
    setBusy(true);
    try {
      const { url } = await commerceApi.promote(book.id, pick);
      window.location.assign(url);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }
  return (
    <Sheet open={open} onClose={onClose} title="🚀 Promote this book">
      <p className="muted small">A promoted book appears in everyone's feed, labelled as promoted, and in the Featured books rail. {book.forSale ? 'Buyers land on your sales page.' : 'It isn’t for sale, so people can open and save it.'}</p>
      {config.testMode && <div className="notice">Test mode — nothing is charged.</div>}
      <div className="book-pick">
        {config.packages.map((p) => (
          <button key={p.id} type="button" aria-pressed={pick === p.id} onClick={() => setPick(p.id)}>
            <span style={{ minWidth: 0 }}>
              <b style={{ fontWeight: 500 }}>{p.name}</b> <span className="muted small">· {p.days} days</span>
              <span className="muted small" style={{ display: 'block' }}>
                {p.blurb}
              </span>
            </span>
            <span className="tick" style={{ color: 'var(--ink)', fontWeight: 600 }}>
              {formatMoney(p.priceCents)}
            </span>
          </button>
        ))}
      </div>
      <div className="row">
        <button type="button" className="btn btn-primary" onClick={go} disabled={busy}>
          {busy ? 'Opening checkout…' : `Pay ${formatMoney(config.packages.find((p) => p.id === pick)?.priceCents ?? 0)}`}
        </button>
        <button type="button" className="btn btn-quiet" onClick={onClose}>
          Not now
        </button>
      </div>
    </Sheet>
  );
}

/** A paid placement in the feed. Labelled, never pretends to be a post. */
export function PromoCard({ promotion }: { promotion: Promotion }) {
  const nav = useNavigate();
  const b = promotion.book;
  function open() {
    void commerceApi.click(promotion.id).catch(() => {});
    nav(`/app/books/${b.id}`);
  }
  return (
    <article className="promo-card">
      <header className="promo-kicker">
        <span className="promo-label">Promoted</span>
        <span className="muted small">
          by{' '}
          <Link to={`/app/u/${b.owner.handle}`} className="post-author">
            {b.owner.displayName}
          </Link>
        </span>
      </header>
      <button type="button" className="promo-body" onClick={open}>
        <span className="book-emoji" aria-hidden="true">
          {b.emoji}
        </span>
        <span style={{ minWidth: 0 }}>
          <h3>{b.name}</h3>
          {b.description && <p className="muted small">{b.description}</p>}
          <p className="small" style={{ marginTop: 4 }}>
            {plural(b.recipeCount, 'recipe')}
            {b.forSale ? ` · ${formatMoney(b.priceCents)}` : ' · free to save'}
          </p>
        </span>
      </button>
      <footer className="post-foot">
        <button type="button" className="btn btn-sm" onClick={open}>
          {b.forSale ? `See inside · ${formatMoney(b.priceCents)}` : 'Open the book'}
        </button>
      </footer>
    </article>
  );
}

/** A public book someone made, in the feed. */
export function BookFeedCard({ book }: { book: RecipeBook }) {
  return (
    <article className="post">
      <header className="post-head">
        <Avatar name={book.owner.displayName} emoji={book.owner.avatar} />
        <div className="grow" style={{ minWidth: 0 }}>
          <Link to={`/app/u/${book.owner.handle}`} className="post-author">
            {book.owner.displayName}
          </Link>
          <span className="muted small"> · 📚 made a recipe book · {timeAgo(book.createdAt)}</span>
        </div>
      </header>
      <Link to={`/app/books/${book.id}`} className="post-recipe">
        <span className="emoji-tile" aria-hidden="true">
          {book.emoji}
        </span>
        <div className="stack grow" style={{ gap: 4, minWidth: 0 }}>
          <h3>{book.name}</h3>
          {book.description && <p className="muted small">{book.description}</p>}
          <p className="muted small num">
            {plural(book.recipeCount, 'recipe')}
            {book.forSale ? ` · ${formatMoney(book.priceCents)}${book.purchased ? ' · owned' : ''}` : ''}
            {book.peek.length > 0 ? ` · ${book.peek.join(' ')}` : ''}
          </p>
        </div>
        <span className="btn btn-sm">{book.forSale && !book.purchased && !book.isMine ? 'See inside' : 'Open'}</span>
      </Link>
    </article>
  );
}
