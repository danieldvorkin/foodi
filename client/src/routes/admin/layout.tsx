import { NavLink, Outlet, useLoaderData, useRouteLoaderData, type LoaderFunctionArgs } from 'react-router';
import type { Me } from '../../api/types';
import { Wordmark } from '../../components/Logo';
import { requireAdmin } from '../../lib/session';
import '../../styles/admin.css';

export async function adminLoader({ request }: LoaderFunctionArgs) {
  const me = await requireAdmin(request);
  return { me };
}

export function useAdminMe(): Me {
  const data = useRouteLoaderData('admin') as { me: Me } | undefined;
  if (!data) throw new Error('useAdminMe outside of /admin');
  return data.me;
}

const NAV = [
  { to: '/admin', label: 'Overview', end: true },
  { to: '/admin/users', label: 'People' },
  { to: '/admin/recipes', label: 'Recipes' },
  { to: '/admin/community', label: 'Feed & comments' },
  { to: '/admin/media', label: 'Photos & videos' },
  { to: '/admin/generations', label: 'Generations' },
  { to: '/admin/settings', label: 'Settings' },
  { to: '/admin/audit', label: 'Audit log' },
];

export function AdminLayout() {
  const { me } = useLoaderData<typeof adminLoader>();
  return (
    <div className="admin-shell">
      <aside className="admin-rail">
        <Wordmark to="/app" />
        <p className="muted small" style={{ marginTop: 6 }}>
          Admin · {me.displayName ?? me.email}
        </p>
        <nav aria-label="Admin">
          {NAV.map((n) => (
            <NavLink key={n.to} to={n.to} end={Boolean(n.end)} className="admin-link">
              {n.label}
            </NavLink>
          ))}
        </nav>
        <NavLink to="/app" className="admin-link" style={{ marginTop: 'auto' }}>
          ← Back to the app
        </NavLink>
      </aside>
      <div className="admin-main">
        <Outlet />
      </div>
    </div>
  );
}
