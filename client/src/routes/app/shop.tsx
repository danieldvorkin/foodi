import { useEffect, useState } from 'react';
import { Link, useLoaderData, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { SHOP_CATEGORIES, SHOP_CATEGORY_EMOJI, formatMoney, type Listing } from '@foodi/shared';
import { media as mediaApi, shop as shopApi } from '../../api/types';
import { Empty } from '../../components/ui';

export async function shopLoader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const category = url.searchParams.get('category') ?? undefined;
  const q = url.searchParams.get('q') ?? undefined;
  const data = await shopApi.list({ ...(category ? { category } : {}), ...(q ? { q } : {}) });
  return { ...data, category: category ?? null, q: q ?? '' };
}

export function ListingCard({ listing }: { listing: Listing }) {
  return (
    <Link to={`/app/shop/${listing.id}`} className="listing-card">
      <span className="listing-media">
        {listing.cover ? <img src={mediaApi.url(listing.cover.id)} alt="" loading="lazy" /> : <span className="listing-fallback" aria-hidden="true">{SHOP_CATEGORY_EMOJI[listing.category]}</span>}
        {listing.status === 'sold_out' && <span className="listing-flag">Sold out</span>}
        {listing.status === 'pending' && <span className="listing-flag">In review</span>}
        {listing.status === 'rejected' && <span className="listing-flag listing-flag-warn">Not approved</span>}
        {listing.status === 'draft' && <span className="listing-flag">Draft</span>}
      </span>
      <span className="listing-body">
        <b className="listing-price">{formatMoney(listing.priceCents, listing.currency)}</b>
        <span className="listing-title">{listing.title}</span>
        <span className="listing-meta">
          {listing.seller.displayName}
          {listing.shipsFrom ? ` · ${listing.shipsFrom}` : ''}
          {listing.condition === 'used' ? ' · used' : ''}
        </span>
      </span>
    </Link>
  );
}

export function ShopPage() {
  const data = useLoaderData<typeof shopLoader>();
  const [params, setParams] = useSearchParams();
  const [more, setMore] = useState<Listing[]>([]);
  const [nextBefore, setNextBefore] = useState(data.nextBefore);
  const [q, setQ] = useState(data.q);
  useEffect(() => {
    setMore([]);
    setNextBefore(data.nextBefore);
    setQ(data.q);
  }, [data]);
  const listings = [...data.listings, ...more];

  function setCategory(c: string | null) {
    const next = new URLSearchParams(params);
    if (c) next.set('category', c);
    else next.delete('category');
    setParams(next, { replace: true });
  }

  return (
    <main className="page stack-lg shop">
      <header className="row-between">
        <div>
          <h1>🛍️ Shop</h1>
          <p className="muted">Gear, jars, books, classes and services from people who cook here. Every listing is checked by a person before it goes live.</p>
        </div>
        <div className="row">
          <Link to="/app/shop/mine" className="btn btn-sm">
            Your listings & orders
          </Link>
          <Link to="/app/shop/new" className="btn btn-primary">
            ＋ Sell something
          </Link>
        </div>
      </header>

      <form
        className="shop-filters"
        onSubmit={(e) => {
          e.preventDefault();
          const next = new URLSearchParams(params);
          if (q.trim()) next.set('q', q.trim());
          else next.delete('q');
          setParams(next, { replace: true });
        }}
      >
        <input className="input" type="search" placeholder="Search the shop" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search the shop" />
        <div className="chips" role="tablist" aria-label="Category">
          <button type="button" role="tab" className="chip" aria-selected={!data.category} aria-pressed={!data.category} onClick={() => setCategory(null)}>
            Everything
          </button>
          {SHOP_CATEGORIES.map((c) => (
            <button key={c} type="button" role="tab" className="chip" aria-selected={data.category === c} aria-pressed={data.category === c} onClick={() => setCategory(c)}>
              {SHOP_CATEGORY_EMOJI[c]} {c}
            </button>
          ))}
        </div>
      </form>

      {listings.length === 0 ? (
        <Empty title={data.q || data.category ? 'Nothing matches' : '🛍️ Nothing for sale yet'} action={<Link to="/app/shop/new" className="btn">List the first thing</Link>}>
          {data.q || data.category ? 'Try another word or category.' : 'A jar of something you make, a pan you don’t use, a class you could teach.'}
        </Empty>
      ) : (
        <>
          <div className="listing-grid">
            {listings.map((l) => (
              <ListingCard key={l.id} listing={l} />
            ))}
          </div>
          {nextBefore && (
            <button
              type="button"
              className="btn btn-block"
              onClick={async () => {
                const r = await shopApi.list({ ...(data.category ? { category: data.category } : {}), ...(data.q ? { q: data.q } : {}), before: nextBefore });
                setMore((m) => [...m, ...r.listings]);
                setNextBefore(r.nextBefore);
              }}
            >
              More
            </button>
          )}
        </>
      )}
    </main>
  );
}
