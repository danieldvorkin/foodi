import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { formatMoney } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { shop as shopApi } from '../../api/types';
import { useToast } from '../../components/Toast';
import { Empty } from '../../components/ui';
import { dateTime } from '../../lib/format';
import { ListingCard } from './shop';

export async function shopMineLoader() {
  const [mine, selling, buying] = await Promise.all([shopApi.mine(), shopApi.orders('selling'), shopApi.orders('buying')]);
  return { listings: mine.listings, selling: selling.orders, buying: buying.orders };
}

const STATUS_LABEL: Record<string, string> = { paid: 'Paid — send it', fulfilled: 'Sent', refunded: 'Refunded', cancelled: 'Cancelled', pending: 'Pending' };

export function ShopMinePage() {
  const { listings, selling, buying } = useLoaderData<typeof shopMineLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'orders' ? 'orders' : params.get('tab') === 'purchases' ? 'purchases' : 'listings';
  const toSend = selling.filter((o) => o.status === 'paid').length;

  return (
    <main className="page stack-lg">
      <header className="row-between">
        <div>
          <h1>🛍️ Your shop</h1>
          <p className="muted">Listings, orders to send, and things you’ve bought.</p>
        </div>
        <Link to="/app/shop/new" className="btn btn-primary">
          ＋ Sell something
        </Link>
      </header>
      <div className="chips" role="tablist">
        {(
          [
            ['listings', `Listings · ${listings.length}`],
            ['orders', `Orders to fulfil${toSend ? ` · ${toSend}` : ''}`],
            ['purchases', `Purchases · ${buying.length}`],
          ] as const
        ).map(([t, label]) => (
          <button key={t} type="button" role="tab" className="chip" aria-selected={tab === t} onClick={() => setParams(t === 'listings' ? {} : { tab: t }, { replace: true })}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'listings' &&
        (listings.length === 0 ? (
          <Empty title="Nothing listed yet" action={<Link to="/app/shop/new" className="btn">Sell something</Link>}>
            Gear, jars, books, classes — every listing is reviewed before it goes live.
          </Empty>
        ) : (
          <div className="listing-grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
        ))}

      {tab === 'orders' &&
        (selling.length === 0 ? (
          <Empty title="No orders yet">When someone buys from you, it shows up here with their delivery note.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Buyer</th>
                  <th className="num">Qty</th>
                  <th className="num">Total</th>
                  <th>Note from buyer</th>
                  <th>Status</th>
                  <th>When</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {selling.map((o) => (
                  <tr key={o.id}>
                    <td className="wrap">{o.listing.id ? <Link to={`/app/shop/${o.listing.id}`}>{o.listing.title}</Link> : o.listing.title}</td>
                    <td>
                      <Link to={`/app/u/${o.buyer.handle}`}>@{o.buyer.handle}</Link>
                    </td>
                    <td className="num">{o.quantity}</td>
                    <td className="num">{formatMoney(o.amountCents, o.currency)}</td>
                    <td className="wrap muted">{o.note || '—'}</td>
                    <td>{STATUS_LABEL[o.status] ?? o.status}</td>
                    <td>{dateTime(o.paidAt ?? o.createdAt)}</td>
                    <td>
                      {o.status === 'paid' && (
                        <button
                          type="button"
                          className="btn btn-primary btn-sm"
                          onClick={async () => {
                            try {
                              await shopApi.fulfil(o.id);
                              toast('Marked as sent — the buyer has been told');
                              revalidate();
                            } catch (e) {
                              toast(errorMessage(e), 'error');
                            }
                          }}
                        >
                          Mark sent
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}

      {tab === 'purchases' &&
        (buying.length === 0 ? (
          <Empty title="Nothing bought yet" action={<Link to="/app/shop" className="btn">Browse the shop</Link>} />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Seller</th>
                  <th className="num">Qty</th>
                  <th className="num">Paid</th>
                  <th>Status</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {buying.map((o) => (
                  <tr key={o.id}>
                    <td className="wrap">{o.listing.id ? <Link to={`/app/shop/${o.listing.id}`}>{o.listing.title}</Link> : o.listing.title}</td>
                    <td>
                      <Link to={`/app/u/${o.seller.handle}`}>@{o.seller.handle}</Link>
                    </td>
                    <td className="num">{o.quantity}</td>
                    <td className="num">{formatMoney(o.amountCents, o.currency)}</td>
                    <td>{o.status === 'fulfilled' ? 'Sent' : o.status === 'paid' ? 'Paid — waiting to be sent' : (STATUS_LABEL[o.status] ?? o.status)}</td>
                    <td>{dateTime(o.paidAt ?? o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
    </main>
  );
}
