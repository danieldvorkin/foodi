import { Link, useLoaderData, useNavigate, useRevalidator, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { ADMIN_PERMISSIONS } from '@foodi/shared';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';
import { useAdminMe } from './layout';

export async function adminUserLoader({ params }: LoaderFunctionArgs) {
  return admin.user(params['id']!);
}

export function AdminUser() {
  const { user, identities, recipes, generations, permissions } = useLoaderData<typeof adminUserLoader>();
  const me = useAdminMe();
  const nav = useNavigate();
  const toast = useToast();
  const { revalidate } = useRevalidator();
  const self = user.id === me.id;

  async function act(fn: () => Promise<unknown>, done: string) {
    try {
      await fn();
      toast(done);
      revalidate();
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  }

  return (
    <>
      <div className="admin-head">
        <div>
          <Link to="/admin/users" className="muted small">
            ← People
          </Link>
          <h1 style={{ marginTop: 6 }}>
            {user.displayName ?? '(no name)'} <span className={`role-pill ${user.role}`}>{user.role}</span>
          </h1>
          <p className="muted small">
            @{user.handle}
            {user.email ? ` · ${user.email}` : ''} · {user.id}
          </p>
        </div>
        <div className="row">
          {!self && (
            <>
              <button type="button" className="btn btn-sm" onClick={() => act(() => admin.updateUser(user.id, { role: user.role === 'admin' ? 'consumer' : 'admin' }), 'Role updated')}>
                {user.role === 'admin' ? 'Make consumer' : 'Make admin'}
              </button>
              <button type="button" className="btn btn-sm" onClick={() => act(() => admin.updateUser(user.id, { disabled: !user.disabledAt }), user.disabledAt ? 'Enabled' : 'Disabled and signed out')}>
                {user.disabledAt ? 'Enable' : 'Disable'}
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm" onClick={() => act(() => admin.revokeSessions(user.id), 'Sessions revoked')}>
            Sign out everywhere
          </button>
          {!self && (
            <button
              type="button"
              className="btn btn-danger btn-sm"
              onClick={async () => {
                if (!window.confirm(`Delete ${user.displayName ?? user.handle} and everything they made?`)) return;
                try {
                  await admin.deleteUser(user.id);
                  toast('Deleted');
                  nav('/admin/users');
                } catch (e) {
                  toast(errorMessage(e), 'error');
                }
              }}
            >
              Delete
            </button>
          )}
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: 'var(--s-6)' }}>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Account</h2>
          <dl className="kv">
            <dt>AI vendor</dt>
            <dd>{user.vendor ? `${user.vendor} (${user.credentialKind})` : 'none connected'}</dd>
            <dt>Joined</dt>
            <dd>{dateTime(user.createdAt)}</dd>
            <dt>Last seen</dt>
            <dd>{dateTime(user.lastSeenAt)}</dd>
            <dt>Active sessions</dt>
            <dd>{user.activeSessions}</dd>
            <dt>Status</dt>
            <dd>{user.disabledAt ? `Disabled ${dateTime(user.disabledAt)}` : 'Active'}</dd>
            <dt>Identities</dt>
            <dd>{identities.map((i) => `${i.provider}${i.email ? ` (${i.email})` : ''}`).join(', ') || '—'}</dd>
          </dl>
          {user.role === 'admin' && (
            <div className="stack" style={{ gap: 'var(--s-2)' }}>
              <h3 style={{ fontSize: 'var(--t-16)' }}>Admin permissions</h3>
              <p className="muted small">Extensions to the admin role. Every admin can moderate; these unlock specific decisions.</p>
              {ADMIN_PERMISSIONS.map((p) => {
                const on = permissions.includes(p.id);
                return (
                  <label key={p.id} className="row" style={{ gap: 10, alignItems: 'flex-start' }}>
                    <input
                      type="checkbox"
                      checked={on}
                      style={{ marginTop: 4 }}
                      onChange={(e) => {
                        const next = e.target.checked ? [...permissions, p.id] : permissions.filter((x) => x !== p.id);
                        void act(() => admin.setPermissions(user.id, next), e.target.checked ? `Granted ${p.name}` : `Revoked ${p.name}`);
                      }}
                    />
                    <span>
                      <b style={{ fontWeight: 500 }}>{p.name}</b> <span className="muted small">({p.id})</span>
                      <span className="muted small" style={{ display: 'block' }}>
                        {p.blurb}
                      </span>
                    </span>
                  </label>
                );
              })}
            </div>
          )}
        </section>
        <section className="stack">
          <h2 style={{ fontSize: 'var(--t-20)' }}>Recipes ({user.recipeCount})</h2>
          <div className="table-wrap">
            <table className="table">
              <tbody>
                {recipes.map((r) => (
                  <tr key={r.id}>
                    <td className="wrap">
                      <Link to={`/app/recipes/${r.id}`}>{r.title}</Link>
                    </td>
                    <td>{r.source}</td>
                    <td>{r.visibility}</td>
                    <td>{dateTime(r.created_at)}</td>
                  </tr>
                ))}
                {recipes.length === 0 && (
                  <tr>
                    <td className="muted">None yet.</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      </div>

      <section className="stack">
        <h2 style={{ fontSize: 'var(--t-20)' }}>Generations ({user.generationCount})</h2>
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>When</th>
                <th>Vendor</th>
                <th>Model</th>
                <th>Status</th>
                <th className="num">Latency</th>
                <th className="num">Tokens in/out</th>
                <th>Recipe</th>
              </tr>
            </thead>
            <tbody>
              {generations.map((g) => (
                <tr key={g.id}>
                  <td>{dateTime(g.createdAt)}</td>
                  <td>{g.vendor}</td>
                  <td>{g.model}</td>
                  <td className={`status-${g.status}`}>{g.status === 'ok' ? 'ok' : g.errorCode}</td>
                  <td className="num">{(g.latencyMs / 1000).toFixed(1)}s</td>
                  <td className="num">
                    {g.inputTokens ?? '—'}/{g.outputTokens ?? '—'}
                  </td>
                  <td>{g.recipeId ? <Link to={`/app/recipes/${g.recipeId}`}>open</Link> : '—'}</td>
                </tr>
              ))}
              {generations.length === 0 && (
                <tr>
                  <td className="muted">None yet.</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
