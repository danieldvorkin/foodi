import { Link, useLoaderData, useRevalidator } from 'react-router';
import { formatMoney } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { commerce as commerceApi } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Empty } from '../../components/ui';
import { dateTime, plural } from '../../lib/format';

export async function salesLoader() {
  const [earnings, config] = await Promise.all([commerceApi.earnings(), commerceApi.config()]);
  return { earnings, config };
}

const STATUS_LABEL: Record<string, string> = { paid: 'Paid', refunded: 'Refunded', active: 'Live', expired: 'Ended', cancelled: 'Stopped', requested: 'Waiting', rejected: 'Declined', pending: 'Pending' };

export function SalesPage() {
  const { earnings: e, config } = useLoaderData<typeof salesLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();

  async function requestPayout() {
    try {
      const r = await commerceApi.requestPayout();
      toast(`Payout of ${formatMoney(r.payout.amountCents)} requested`);
      revalidate();
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  }

  return (
    <main className="page-narrow stack-lg" style={{ maxWidth: 820 }}>
      <header>
        <h1>💵 Sales & payouts</h1>
        <p className="muted">What your recipe books have earned, what you’ve spent on promotion, and what’s ready to pay out.</p>
      </header>
      {config.testMode && <div className="notice">Test mode — these are practice sales. Nothing has actually been charged or paid out.</div>}

      <section className="numbers">
        <div>
          <div className="n num">{formatMoney(e.availableCents)}</div>
          <div className="l">available to pay out</div>
        </div>
        <div>
          <div className="n num">{formatMoney(e.netCents)}</div>
          <div className="l">
            earned from {plural(e.salesCount, 'sale')} (after foodi’s {config.platformFeePercent}%)
          </div>
        </div>
        <div>
          <div className="n num">{formatMoney(e.paidOutCents)}</div>
          <div className="l">paid out so far</div>
        </div>
        <div>
          <div className="n num">{formatMoney(e.spentOnPromotionsCents)}</div>
          <div className="l">spent on promotions</div>
        </div>
      </section>

      <div className="row">
        <button type="button" className="btn btn-primary" onClick={requestPayout} disabled={e.availableCents <= 0 || e.payouts.some((p) => p.status === 'requested')}>
          Request payout {e.availableCents > 0 ? `· ${formatMoney(e.availableCents)}` : ''}
        </button>
        <span className="hint">Payouts are sent by hand by the foodi team; you’ll get a notification when it goes out.</span>
      </div>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Sales</h2>
        {e.purchases.length === 0 ? (
          <Empty title="No sales yet" action={<Link to="/app/books" className="btn">Sell a book</Link>}>
            Open one of your recipe books and choose “Sell”. Every recipe in it has to be your own.
          </Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Buyer</th>
                  <th className="num">Price</th>
                  <th className="num">You earn</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {e.purchases.map((p) => (
                  <tr key={p.id}>
                    <td className="wrap">
                      {p.book.emoji} {p.book.id ? <Link to={`/app/books/${p.book.id}`}>{p.book.name}</Link> : p.book.name}
                    </td>
                    <td>
                      <Link to={`/app/u/${p.buyer.handle}`}>@{p.buyer.handle}</Link>
                    </td>
                    <td className="num">{formatMoney(p.amountCents)}</td>
                    <td className="num">{p.status === 'paid' ? formatMoney(p.amountCents - p.platformFeeCents) : '—'}</td>
                    <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td>{dateTime(p.paidAt ?? p.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Promotions</h2>
        {e.promotions.length === 0 ? (
          <p className="muted small">Nothing promoted yet. Open a public book and choose “Promote” to put it in everyone’s feed.</p>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>Package</th>
                  <th className="num">Cost</th>
                  <th className="num">Seen</th>
                  <th className="num">Clicks</th>
                  <th>Status</th>
                  <th>Ends</th>
                </tr>
              </thead>
              <tbody>
                {e.promotions.map((p) => (
                  <tr key={p.id}>
                    <td className="wrap">
                      {p.book.emoji} <Link to={`/app/books/${p.book.id}`}>{p.book.name}</Link>
                    </td>
                    <td>{p.packageName}</td>
                    <td className="num">{formatMoney(p.amountCents)}</td>
                    <td className="num">{p.impressions}</td>
                    <td className="num">{p.clicks}</td>
                    <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td>{dateTime(p.endsAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {e.payouts.length > 0 && (
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Payouts</h2>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th className="num">Amount</th>
                  <th>Status</th>
                  <th>Requested</th>
                  <th>Note</th>
                </tr>
              </thead>
              <tbody>
                {e.payouts.map((p) => (
                  <tr key={p.id}>
                    <td className="num">{formatMoney(p.amountCents)}</td>
                    <td>{STATUS_LABEL[p.status] ?? p.status}</td>
                    <td>{dateTime(p.createdAt)}</td>
                    <td className="wrap muted">{p.note || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
