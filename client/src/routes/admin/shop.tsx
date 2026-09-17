import { useState } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams } from 'react-router';
import { SHOP_CATEGORY_EMOJI, formatMoney, type Listing } from '@foodi/shared';
import { errorMessage } from '../../api/client';
import { admin, media as mediaApi } from '../../api/types';
import { Prose } from '../../components/Prose';
import { useToast } from '../../components/Toast';
import { Sheet } from '../../components/ui';
import { dateTime } from '../../lib/format';

export async function adminShopLoader({ request }: { request: Request }) {
  const status = new URL(request.url).searchParams.get('status') ?? 'pending';
  const data = await admin.shop(status === 'all' ? undefined : status);
  return { ...data, status };
}

export function AdminShop() {
  const { listings, canApprove, pending, status } = useLoaderData<typeof adminShopLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const [params, setParams] = useSearchParams();
  const [open, setOpen] = useState<Listing | null>(null);
  const [reason, setReason] = useState('');

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast(done);
      setOpen(null);
      setReason('');
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Shop listings</h1>
          <p className="muted small">
            {pending} waiting for review.{' '}
            {canApprove ? 'You can approve and reject.' : (
              <>
                You can view and take down, but approving needs the <b>posting-approvals</b> permission — another admin can grant it to you under People.
              </>
            )}
          </p>
        </div>
        <div className="chips" role="tablist">
          {['pending', 'approved', 'rejected', 'all'].map((s) => (
            <button key={s} type="button" role="tab" className="chip" aria-selected={status === s} aria-pressed={status === s} onClick={() => setParams({ status: s }, { replace: true })}>
              {s}
              {s === 'pending' && pending > 0 ? ` · ${pending}` : ''}
            </button>
          ))}
        </div>
      </div>

      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th></th>
              <th>Listing</th>
              <th>Seller</th>
              <th className="num">Price</th>
              <th>Status</th>
              <th>{status === 'pending' ? 'Submitted' : 'Updated'}</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {listings.map((l) => (
              <tr key={l.id}>
                <td>{l.cover ? <img src={mediaApi.url(l.cover.id)} alt="" style={{ width: 44, height: 44, objectFit: 'cover', borderRadius: 6 }} /> : <span style={{ fontSize: 22 }}>{SHOP_CATEGORY_EMOJI[l.category]}</span>}</td>
                <td className="wrap">
                  <button type="button" className="btn btn-quiet btn-sm" style={{ padding: 0, fontWeight: 500 }} onClick={() => setOpen(l)}>
                    {l.title}
                  </button>
                  <div className="muted small">
                    {l.category}
                    {l.quantity !== null ? ` · ${l.quantity} in stock` : ''}
                    {l.soldCount ? ` · ${l.soldCount} sold` : ''}
                  </div>
                </td>
                <td>
                  <Link to={`/admin/users/${l.seller.id}`}>@{l.seller.handle}</Link>
                </td>
                <td className="num">{formatMoney(l.priceCents, l.currency)}</td>
                <td>
                  {l.status}
                  {l.status === 'rejected' && l.rejectionReason ? <div className="muted small wrap">{l.rejectionReason}</div> : null}
                </td>
                <td>{dateTime(status === 'pending' ? l.submittedAt : l.updatedAt)}</td>
                <td>
                  <button type="button" className="btn btn-sm" onClick={() => setOpen(l)}>
                    Review
                  </button>
                </td>
              </tr>
            ))}
            {listings.length === 0 && (
              <tr>
                <td className="muted" colSpan={7}>
                  {status === 'pending' ? 'Queue is empty. 🎉' : 'Nothing here.'}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <Sheet open={open !== null} onClose={() => setOpen(null)} title={open ? `${SHOP_CATEGORY_EMOJI[open.category]} ${open.title}` : ''}>
        {open && (
          <div className="stack">
            <p className="muted small">
              {formatMoney(open.priceCents, open.currency)} · {open.category}
              {open.condition ? ` · ${open.condition}` : ''}
              {open.shipsFrom ? ` · from ${open.shipsFrom}` : ''} · by <Link to={`/app/u/${open.seller.handle}`}>@{open.seller.handle}</Link> ·{' '}
              <Link to={`/app/shop/${open.id}`}>open listing</Link>
            </p>
            {open.media.length > 0 && (
              <div className="gallery gallery-strip">
                {open.media.map((m) => (
                  <img key={m.id} src={mediaApi.url(m.id)} alt="" style={{ height: 96, borderRadius: 6 }} />
                ))}
              </div>
            )}
            <div style={{ maxHeight: 260, overflow: 'auto' }}>
              <Prose text={open.description} />
            </div>
            <div className="field">
              <label htmlFor="reason">Reason (required to reject or take down; the seller sees it)</label>
              <input id="reason" className="input" value={reason} onChange={(e) => setReason(e.target.value)} maxLength={500} placeholder="e.g. Photos must show the actual item" />
            </div>
            <div className="row">
              {open.status === 'pending' && canApprove && (
                <>
                  <button type="button" className="btn btn-primary" onClick={() => act(() => admin.reviewListing(open.id, 'approve'), 'Approved — it’s live')}>
                    Approve
                  </button>
                  <button type="button" className="btn btn-danger" disabled={!reason.trim()} onClick={() => act(() => admin.reviewListing(open.id, 'reject', reason.trim()), 'Rejected')}>
                    Reject
                  </button>
                </>
              )}
              {open.status === 'pending' && !canApprove && <span className="hint">You need the posting-approvals permission to decide this one.</span>}
              {(open.status === 'approved' || open.status === 'sold_out') && (
                <button type="button" className="btn btn-danger" disabled={!reason.trim()} onClick={() => act(() => admin.takedownListing(open.id, reason.trim()), 'Taken down')}>
                  Take down
                </button>
              )}
              <button type="button" className="btn btn-quiet" onClick={() => setOpen(null)}>
                Close
              </button>
            </div>
          </div>
        )}
      </Sheet>
    </>
  );
}
