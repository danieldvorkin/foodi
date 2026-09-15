import { Link, useLoaderData } from 'react-router';
import { admin } from '../../api/types';
import { dateTime } from '../../lib/format';

export async function adminAuditLoader() {
  return admin.audit();
}

export function AdminAudit() {
  const { entries } = useLoaderData<typeof adminAuditLoader>();
  return (
    <>
      <div className="admin-head">
        <div>
          <h1>Audit log</h1>
          <p className="muted small">Every admin action, newest first. This log can’t be edited from the app.</p>
        </div>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>Action</th>
              <th>Target</th>
              <th>Detail</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id}>
                <td>{dateTime(e.createdAt)}</td>
                <td>
                  <Link to={`/admin/users/${e.actorId}`}>{e.actorDisplayName ?? e.actorId}</Link>
                </td>
                <td>{e.action}</td>
                <td>
                  {e.targetType}
                  {e.targetId ? (
                    <span className="muted tiny"> {e.targetType === 'user' ? <Link to={`/admin/users/${e.targetId}`}>{e.targetId}</Link> : e.targetId}</span>
                  ) : null}
                </td>
                <td className="wrap muted tiny">{e.detail ?? '—'}</td>
              </tr>
            ))}
            {entries.length === 0 && (
              <tr>
                <td className="muted" colSpan={5}>
                  Nothing has happened yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
