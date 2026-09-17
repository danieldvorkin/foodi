import { useState } from 'react';
import { Link, redirect, useLoaderData, useNavigate, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { formatMoney } from '@foodi/shared';
import { errorMessage } from '../api/client';
import { commerce as commerceApi } from '../api/types';
import { Wordmark } from '../components/Logo';
import { requireMe } from '../lib/session';

/** The stand-in for a card form when no payment provider is configured. Loud about being fake. */
export async function testCheckoutLoader({ params, request }: LoaderFunctionArgs) {
  await requireMe(request);
  const raw = params['kind'];
  if (raw !== 'book' && raw !== 'promo') throw redirect('/app');
  const kind: 'book' | 'promo' = raw;
  const order = await commerceApi.testOrder(kind, params['id']!);
  return { kind, id: params['id']!, order };
}

export function TestCheckout() {
  const { kind, id, order } = useLoaderData<typeof testCheckoutLoader>();
  const nav = useNavigate();
  const [busy, setBusy] = useState<'pay' | 'cancel' | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function act(what: 'pay' | 'cancel') {
    setBusy(what);
    setError(null);
    try {
      const r = what === 'pay' ? await commerceApi.testComplete(kind, id) : await commerceApi.testCancel(kind, id);
      nav(what === 'pay' ? `/app/pay/done?kind=${kind}&id=${encodeURIComponent(id)}` : `${r.returnTo}?checkout=cancelled`, { replace: true });
    } catch (e) {
      setError(errorMessage(e));
      setBusy(null);
    }
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 520 }}>
      <Wordmark />
      <div className="notice notice-warn">
        <b>Test checkout.</b> No payment provider is connected, so this page stands in for the card form. Nothing is charged.
      </div>
      <div className="card stack" style={{ padding: 'var(--s-5)' }}>
        <p className="muted small">{kind === 'book' ? 'Recipe book' : 'Promotion'}</p>
        <h1 style={{ fontSize: 'var(--t-25)' }}>{order.name}</h1>
        <p style={{ fontSize: 'var(--t-31)', fontWeight: 600 }}>{formatMoney(order.amountCents, order.currency)}</p>
        {order.status !== 'pending' ? (
          <p className="muted">This order is already {order.status}.</p>
        ) : (
          <div className="row">
            <button type="button" className="btn btn-primary btn-lg" onClick={() => act('pay')} disabled={busy !== null}>
              {busy === 'pay' ? 'Paying…' : 'Pay (test)'}
            </button>
            <button type="button" className="btn btn-lg" onClick={() => act('cancel')} disabled={busy !== null}>
              Cancel
            </button>
          </div>
        )}
        {error && (
          <p className="error-text" role="alert">
            {error}
          </p>
        )}
      </div>
      <p className="hint">
        <Link to={order.returnTo}>Back to the book</Link>
      </p>
    </main>
  );
}

/** Where Stripe (or the test page) sends people after paying. */
export function PayDone() {
  const [params] = useSearchParams();
  const kind = params.get('kind');
  const id = params.get('id');
  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 560, textAlign: 'center', paddingTop: 'var(--s-8)' }}>
      <div style={{ fontSize: 56 }} aria-hidden="true">
        {kind === 'promo' ? '🚀' : '📚'}
      </div>
      <h1>{kind === 'promo' ? 'Your promotion is live' : 'It’s yours'}</h1>
      <p className="muted measure" style={{ marginInline: 'auto' }}>
        {kind === 'promo'
          ? 'Your book is now in the feed and the Featured rail. Track impressions and clicks on your sales page.'
          : 'The whole book is unlocked, including cook mode and adapting. It stays in your library under Recipe books.'}
      </p>
      <div className="row" style={{ justifyContent: 'center' }}>
        {kind === 'promo' ? (
          <Link to="/app/sales" className="btn btn-primary">
            See the promotion
          </Link>
        ) : (
          <Link to="/app/books" className="btn btn-primary">
            Open your library
          </Link>
        )}
        <Link to="/app" className="btn">
          Back to the feed
        </Link>
      </div>
      {!id && <p className="hint">If you paid but don’t see the book, give it a minute — the payment confirmation can lag.</p>}
    </main>
  );
}
