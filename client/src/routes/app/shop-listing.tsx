import { useState } from 'react';
import { Link, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { SHOP_CATEGORY_EMOJI, formatMoney } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { commerce as commerceApi, shop as shopApi } from '../../api/types';
import { MediaGallery } from '../../components/Media';
import { Prose } from '../../components/Prose';
import { useToast } from '../../components/Toast';
import { Avatar, Sheet } from '../../components/ui';
import { plural, timeAgo } from '../../lib/format';
import { useMe } from './layout';

export async function listingLoader({ params }: LoaderFunctionArgs) {
  const [{ listing }, config] = await Promise.all([shopApi.get(params['id']!), commerceApi.config()]);
  return { listing, config };
}

const STATUS_COPY: Record<string, string> = {
  draft: 'This is a draft. Submit it for review when it’s ready.',
  pending: 'In review. An admin checks every listing before it goes live — you’ll get a notification either way.',
  rejected: 'Not approved.',
  archived: 'Archived — not visible in the shop.',
  sold_out: 'Sold out. Edit the quantity to relist.',
};

export function ListingPage() {
  const { listing: l, config } = useLoaderData<typeof listingLoader>();
  const me = useMe();
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [buying, setBuying] = useState(false);
  const [qty, setQty] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const canBuy = l.status === 'approved' && !l.isMine && config.paymentsEnabled;

  async function buy() {
    setBusy(true);
    try {
      const { url } = await shopApi.buy(l.id, qty, note.trim());
      window.location.assign(url);
    } catch (e) {
      toast(errorMessage(e), 'error');
      setBusy(false);
    }
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 900 }}>
      <Link to="/app/shop" className="muted small">
        ← Shop
      </Link>
      {params.get('checkout') === 'cancelled' && <div className="notice">Checkout cancelled — nothing was charged.</div>}
      {l.isMine && l.status !== 'approved' && (
        <div className={`notice ${l.status === 'rejected' ? 'notice-warn' : ''}`}>
          {STATUS_COPY[l.status]}
          {l.status === 'rejected' && l.rejectionReason ? ` Reason: ${l.rejectionReason}` : ''}
          {l.status === 'rejected' || l.status === 'draft' ? (
            <>
              {' '}
              <Link to={`/app/shop/${l.id}/edit`}>Edit and resubmit</Link>.
            </>
          ) : null}
        </div>
      )}
      {!l.isMine && me.role === 'admin' && l.status === 'pending' && <div className="notice">Pending review — this is only visible to admins and the seller.</div>}

      <div className="listing-layout">
        <div className="listing-gallery">
          {l.media.length > 0 ? (
            <MediaGallery items={l.media} layout="hero" />
          ) : (
            <div className="listing-fallback listing-fallback-lg" aria-hidden="true">
              {SHOP_CATEGORY_EMOJI[l.category]}
            </div>
          )}
        </div>
        <div className="stack listing-side">
          <p className="muted small">
            {SHOP_CATEGORY_EMOJI[l.category]} {l.category}
            {l.condition ? ` · ${l.condition}` : ''}
            {l.shipsFrom ? ` · from ${l.shipsFrom}` : ''}
          </p>
          <h1 style={{ fontSize: 'var(--t-31)' }}>{l.title}</h1>
          <p className="listing-price-lg">{formatMoney(l.priceCents, l.currency)}</p>
          <p className="muted small">
            {l.quantity === null ? 'Always available' : l.quantity > 0 ? `${l.quantity} left` : 'Sold out'}
            {l.soldCount > 0 ? ` · ${l.soldCount} sold` : ''}
          </p>
          <div className="row" style={{ gap: 10 }}>
            <Link to={`/app/u/${l.seller.handle}`} aria-label={l.seller.displayName}>
              <Avatar name={l.seller.displayName} emoji={l.seller.avatar} />
            </Link>
            <span>
              <Link to={`/app/u/${l.seller.handle}`} className="post-author">
                {l.seller.displayName}
              </Link>
              <span className="muted small"> · listed {timeAgo(l.reviewedAt ?? l.createdAt)}</span>
            </span>
          </div>
          {canBuy && (
            <button type="button" className="btn btn-primary btn-lg" onClick={() => setBuying(true)}>
              Buy · {formatMoney(l.priceCents, l.currency)}
            </button>
          )}
          {l.status === 'sold_out' && !l.isMine && <p className="notice">Sold out.</p>}
          {config.testMode && canBuy && <p className="hint">Test mode: checkout is simulated and nothing is charged.</p>}
          {l.isMine && (
            <div className="row">
              <Link to={`/app/shop/${l.id}/edit`} className="btn btn-sm">
                Edit
              </Link>
              {l.status !== 'archived' && (
                <button
                  type="button"
                  className="btn btn-quiet btn-sm"
                  onClick={async () => {
                    if (!window.confirm('Archive this listing? It disappears from the shop; orders already placed are kept.')) return;
                    await shopApi.archive(l.id).catch((e) => toast(errorMessage(e), 'error'));
                    nav('/app/shop/mine');
                  }}
                >
                  Archive
                </button>
              )}
            </div>
          )}
        </div>
      </div>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>About this listing</h2>
        <Prose text={l.description} />
      </section>
      <p className="hint">Payments go through foodi; the seller sends the item and marks it as sent. Problems with an order? Contact an admin from Settings.</p>

      <Sheet open={buying} onClose={() => setBuying(false)} title={`Buy ${l.title}`}>
        <div className="stack">
          {l.quantity !== 1 && (
            <div className="field">
              <label htmlFor="qty">How many</label>
              <input id="qty" className="input" type="number" min={1} max={l.quantity ?? 50} value={qty} onChange={(e) => setQty(Math.max(1, Math.min(l.quantity ?? 50, Number(e.target.value) || 1)))} style={{ maxWidth: 120 }} />
            </div>
          )}
          <div className="field">
            <label htmlFor="note">Delivery details or a message for {l.seller.displayName}</label>
            <textarea id="note" className="textarea" value={note} onChange={(e) => setNote(e.target.value)} maxLength={500} placeholder="Address, pickup preference, size, anything they need to know" />
            <p className="hint">Only the seller sees this.</p>
          </div>
          <div className="row">
            <button type="button" className="btn btn-primary" onClick={buy} disabled={busy}>
              {busy ? 'Opening checkout…' : `Pay ${formatMoney(l.priceCents * qty, l.currency)}`}
            </button>
            <span className="muted small">{plural(qty, 'item')}</span>
          </div>
        </div>
      </Sheet>
    </main>
  );
}
