import { useState } from 'react';
import { Link, useLoaderData, useRevalidator } from 'react-router';
import { formatMoney, type Payout } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Sheet } from '../../components/ui';
import { dateTime } from '../../lib/format';

export async function adminCommerceLoader() {
  const [data, settings] = await Promise.all([admin.commerce(), admin.settings()]);
  return { ...data, settings: settings.settings };
}

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', refunded: 'Refunded', active: 'Live', expired: 'Ended', cancelled: 'Stopped', requested: 'Waiting', rejected: 'Declined', pending: 'Pending' };

export function AdminCommerce() {
  const { stats, provider, purchases, promotions, payouts, settings } = useLoaderData<typeof adminCommerceLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [s, setS] = useState(settings);
  const [busy, setBusy] = useState(false);
  const [resolving, setResolving] = useState<{ payout: Payout; status: 'paid' | 'rejected' } | null>(null);
  const [note, setNote] = useState('');

  async function run(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast(done);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }
  async function saveSettings() {
    setBusy(true);
    await run(() => admin.updateSettings({ paymentsEnabled: s.paymentsEnabled, promotionsEnabled: s.promotionsEnabled, platformFeePercent: s.platformFeePercent }), 'Saved');
    setBusy(false);
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Sales, promotions & payouts</h1>
          <p className="muted small">
            Payment provider: <b>{provider.id === 'stripe' ? 'Stripe' : 'test mode (no charges)'}</b>
            {provider.id === 'stripe' && !provider.webhookConfigured ? ' — STRIPE_WEBHOOK_SECRET is missing, so paid orders will not complete.' : ''}
          </p>
        </div>
      </div>

      <div className="numbers">
        <div>
          <div className="n num">{formatMoney(stats.platformFeesCents + stats.promotionRevenueCents)}</div>
          <div className="l">foodi revenue (fees + promotions)</div>
        </div>
        <div>
          <div className="n num">{formatMoney(stats.salesGrossCents)}</div>
          <div className="l">
            book sales, {stats.purchases} paid · {stats.refunds} refunded
          </div>
        </div>
        <div>
          <div className="n num">{stats.activePromotions}</div>
          <div className="l">live promotions · {formatMoney(stats.promotionRevenueCents)} all time</div>
        </div>
        <div>
          <div className="n num">{formatMoney(stats.pendingPayoutCents)}</div>
          <div className="l">
            owed in {stats.pendingPayouts} payout {stats.pendingPayouts === 1 ? 'request' : 'requests'}
          </div>
        </div>
        <div>
          <div className="n num">{stats.booksForSale}</div>
          <div className="l">books for sale</div>
        </div>
      </div>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Payout requests</h2>
        {payouts.length === 0 ? (
          <p className="muted small">No payout requests yet.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Seller</th>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Note</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {payouts.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link to={`/admin/users/${p.user.id}`}>@{p.user.handle}</Link>
                    </td>
                    <td className="num">{formatMoney(p.amountCents)}</td>
                    <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td>{dateTime(p.createdAt)}</td>
                    <td className="wrap muted">{p.note || '—'}</td>
                    <td>
                      {p.status === 'requested' && (
                        <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                          <button type="button" className="btn btn-primary btn-sm" onClick={() => { setNote(''); setResolving({ payout: p, status: 'paid' }); }}>
                            Mark paid
                          </button>
                          <button type="button" className="btn btn-quiet btn-sm" onClick={() => { setNote(''); setResolving({ payout: p, status: 'rejected' }); }}>
                            Decline
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <p className="hint">Payouts are sent outside foodi (bank transfer, e-transfer, PayPal). Mark them paid here once the money has gone.</p>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Purchases</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Book</th>
                <th>Buyer</th>
                <th>Seller</th>
                <th className="num">Price</th>
                <th className="num">Fee</th>
                <th>Via</th>
                <th>Status</th>
                <th>When</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {purchases.map((p) => (
                <tr key={p.id}>
                  <td className="wrap">
                    {p.book.emoji} {p.book.id ? <Link to={`/app/books/${p.book.id}`}>{p.book.name}</Link> : p.book.name}
                  </td>
                  <td>
                    <Link to={`/admin/users/${p.buyer.id}`}>@{p.buyer.handle}</Link>
                  </td>
                  <td>
                    <Link to={`/admin/users/${p.seller.id}`}>@{p.seller.handle}</Link>
                  </td>
                  <td className="num">{formatMoney(p.amountCents)}</td>
                  <td className="num">{formatMoney(p.platformFeeCents)}</td>
                  <td>{p.provider}</td>
                  <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                  <td>{dateTime(p.paidAt ?? p.createdAt)}</td>
                  <td>
                    {p.status === 'paid' && (
                      <button
                        type="button"
                        className="btn btn-quiet btn-sm"
                        onClick={() => {
                          if (!window.confirm(`Refund ${formatMoney(p.amountCents)} to @${p.buyer.handle}? They lose access to the book.`)) return;
                          void run(() => admin.refund(p.id), 'Refunded');
                        }}
                      >
                        Refund
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {purchases.length === 0 && (
                <tr>
                  <td className="muted" colSpan={9}>
                    No purchases yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Promotions</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Book</th>
                <th>Owner</th>
                <th>Package</th>
                <th className="num">Paid</th>
                <th className="num">Seen</th>
                <th className="num">Clicks</th>
                <th>Status</th>
                <th>Ends</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {promotions.map((p) => (
                <tr key={p.id}>
                  <td className="wrap">
                    {p.book.emoji} <Link to={`/app/books/${p.book.id}`}>{p.book.name}</Link>
                  </td>
                  <td>
                    <Link to={`/admin/users/${p.book.owner.id}`}>@{p.book.owner.handle}</Link>
                  </td>
                  <td>{p.packageName}</td>
                  <td className="num">{formatMoney(p.amountCents)}</td>
                  <td className="num">{p.impressions}</td>
                  <td className="num">{p.clicks}</td>
                  <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                  <td>{dateTime(p.endsAt)}</td>
                  <td>
                    {p.status === 'active' && (
                      <button type="button" className="btn btn-quiet btn-sm" onClick={() => window.confirm('Stop this promotion now? No refund is issued automatically.') && void run(() => admin.cancelPromotion(p.id), 'Stopped')}>
                        Stop
                      </button>
                    )}
                  </td>
                </tr>
              ))}
              {promotions.length === 0 && (
                <tr>
                  <td className="muted" colSpan={9}>
                    No promotions yet.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      <section className="stack" style={{ maxWidth: 520 }}>
        <h2 style={{ fontSize: 'var(--t-20)' }}>Settings</h2>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={s.paymentsEnabled} onChange={(e) => setS({ ...s, paymentsEnabled: e.target.checked })} />
          <span>People can sell and buy recipe books</span>
        </label>
        <label className="row" style={{ gap: 10 }}>
          <input type="checkbox" checked={s.promotionsEnabled} onChange={(e) => setS({ ...s, promotionsEnabled: e.target.checked })} />
          <span>People can buy promotions</span>
        </label>
        <div className="field">
          <label htmlFor="fee">foodi’s cut of each book sale (%)</label>
          <input id="fee" className="input" type="number" min={0} max={50} value={s.platformFeePercent} onChange={(e) => setS({ ...s, platformFeePercent: Number(e.target.value) || 0 })} style={{ maxWidth: 160 }} />
          <p className="hint">Applied to new sales only. Promotion prices are fixed in code (`shared/src/commerce.ts`).</p>
        </div>
        <div className="row">
          <button type="button" className="btn btn-primary" onClick={saveSettings} disabled={busy}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </section>

      <Sheet open={resolving !== null} onClose={() => setResolving(null)} title={resolving?.status === 'paid' ? 'Mark payout as paid' : 'Decline payout'}>
        {resolving && (
          <div className="stack">
            <p>
              {formatMoney(resolving.payout.amountCents)} to @{resolving.payout.user.handle}
            </p>
            <div className="field">
              <label htmlFor="pnote">Note to the seller</label>
              <input id="pnote" className="input" value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder={resolving.status === 'paid' ? 'e.g. Sent by e-transfer on Sep 16' : 'e.g. Please add a payout email in your profile bio first'} />
            </div>
            <div className="row">
              <button
                type="button"
                className={`btn ${resolving.status === 'paid' ? 'btn-primary' : 'btn-danger'}`}
                onClick={async () => {
                  const r = resolving;
                  setResolving(null);
                  await run(() => admin.resolvePayout(r.payout.id, r.status, note.trim()), r.status === 'paid' ? 'Marked paid' : 'Declined');
                }}
              >
                {resolving.status === 'paid' ? 'Confirm paid' : 'Decline'}
              </button>
              <button type="button" className="btn btn-quiet" onClick={() => setResolving(null)}>
                Back
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
