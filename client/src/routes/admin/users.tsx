import { useState } from 'react';
import { Link, useLoaderData, useRevalidator, useSearchParams, type LoaderFunctionArgs } from 'react-router';
import { errorMessage } from '../../api/client';
import { admin } from '../../api/types';
import { useToast } from '../../components/Toast';
import { dateTime } from '../../lib/format';
import { useAdminMe } from './layout';

export async function adminUsersLoader({ request }: LoaderFunctionArgs) {
  const q = new URL(request.url).searchParams.get('q') ?? '';
  return admin.users(q || undefined);
}

export function AdminUsers() {
  const { users } = useLoaderData<typeof adminUsersLoader>();
  const [params, setParams] = useSearchParams();
  const [q, setQ] = useState(params.get('q') ?? '');
  const { revalidate } = useRevalidator();
  const toast = useToast();
  const me = useAdminMe();

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
          <h1>People</h1>
          <p className="muted small">{users.length} shown. Roles: admin can see this panel; consumer can’t.</p>
        </div>
        <form
          className="admin-toolbar"
          onSubmit={(e) => {
            e.preventDefault();
            setParams(q ? { q } : {});
          }}
        >
          <input className="input" type="search" placeholder="Search name, email, handle" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn btn-sm" type="submit">
            Search
          </button>
        </form>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>Person</th>
              <th>Role</th>
              <th>AI</th>
              <th className="num">Recipes</th>
              <th className="num">Generations</th>
              <th className="num">Sessions</th>
              <th>Last seen</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id} style={u.disabledAt ? { opacity: 0.55 } : undefined}>
                <td>
                  <Link to={`/admin/users/${u.id}`}>{u.displayName ?? '(no name)'}</Link>
                  <div className="muted tiny">
                    @{u.handle}
                    {u.email ? ` · ${u.email}` : ''}
                    {u.disabledAt ? ' · disabled' : ''}
                  </div>
                </td>
                <td>
                  <span className={`role-pill ${u.role}`}>{u.role}</span>
                </td>
                <td>
                  {u.vendor} <span className="muted tiny">{u.credentialKind}</span>
                </td>
                <td className="num">{u.recipeCount}</td>
                <td className="num">{u.generationCount}</td>
                <td className="num">{u.activeSessions}</td>
                <td>{dateTime(u.lastSeenAt)}</td>
                <td>{dateTime(u.createdAt)}</td>
                <td>
                  <div className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
                    {u.id !== me.id && (
                      <>
                        <button type="button" className="btn btn-sm" onClick={() => act(() => admin.updateUser(u.id, { role: u.role === 'admin' ? 'consumer' : 'admin' }), u.role === 'admin' ? 'Now a consumer' : 'Now an admin')}>
                          {u.role === 'admin' ? 'Make consumer' : 'Make admin'}
                        </button>
                        <button type="button" className="btn btn-sm" onClick={() => act(() => admin.updateUser(u.id, { disabled: !u.disabledAt }), u.disabledAt ? 'Enabled' : 'Disabled')}>
                          {u.disabledAt ? 'Enable' : 'Disable'}
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
