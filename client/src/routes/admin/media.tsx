import { Link, useLoaderData, useRevalidator } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin, media as mediaApi } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';

export async function adminMediaLoader() {
  return admin.media();
}

const mb = (n: number) => `${(n / 1024 / 1024).toFixed(1)} MB`;

export function AdminMedia() {
  const { media } = useLoaderData<typeof adminMediaLoader>();
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const total = media.reduce((a, m) => a + m.bytes, 0);
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>📷 Photos & videos</h1>
          <p className="muted small">
            {media.length} files, {mb(total)} on disk. Files live in the uploads folder; deleting here removes the file and unlinks it everywhere.
          </p>
        </div>
      </div>
      <div className="media-admin-grid">
        {media.map((m) => (
          <figure key={m.id} className="media-admin-item">
            {m.kind === 'video' ? <video src={mediaApi.url(m.id)} preload="metadata" muted playsInline /> : <img src={mediaApi.url(m.id)} alt="" loading="lazy" />}
            <figcaption>
              <div className="tiny">
                <Link to={`/admin/users/${m.ownerId}`}>@{m.handle}</Link> · {m.kind} · {mb(m.bytes)}
              </div>
              <div className="muted tiny">
                {dateTime(m.createdAt)}
                {m.recipeId ? (
                  <>
                    {' '}
                    · <Link to={`/app/recipes/${m.recipeId}`}>recipe</Link>
                  </>
                ) : m.postId ? (
                  <>
                    {' '}
                    · <Link to={`/app/posts/${m.postId}`}>post</Link>
                  </>
                ) : (
                  ' · unattached'
                )}
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={async () => {
                  if (!window.confirm('Delete this file for everyone?')) return;
                  try {
                    await admin.deleteMedia(m.id);
                    toast('Deleted');
                    revalidate();
                  } catch (e) {
                    toast(errorMessage(e), 'error');
                  }
                }}
              >
                Delete
              </button>
            </figcaption>
          </figure>
        ))}
        {media.length === 0 && <p className="muted">Nothing uploaded yet.</p>}
      </div>
    </>
  );
}
