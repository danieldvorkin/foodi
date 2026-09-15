import { NavLink, Outlet, useLoaderData, useNavigate, useRouteLoaderData, type LoaderFunctionArgs } from 'react-router';
import { auth, type Me } from '../../api/types';
import { Wordmark } from '../../components/Logo';
import { Avatar } from '../../components/ui';
import { requireOnboarded } from '../../lib/session';

export async function appLoader({ request }: LoaderFunctionArgs) {
  const me = await requireOnboarded(request);
  return { me };
}

export function useMe(): Me {
  const data = useRouteLoaderData('app') as { me: Me } | undefined;
  if (!data) throw new Error('useMe outside of /app');
  return data.me;
}

export function AppLayout() {
  const { me } = useLoaderData<typeof appLoader>();
  const nav = useNavigate();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark to="/app" />
          <nav aria-label="Main">
            <NavLink to="/app" end className="navlink">
              🍳 Cook
            </NavLink>
            <NavLink to="/app/feed" className="navlink">
              📣 Feed
            </NavLink>
            <NavLink to="/app/recipes/new" className="navlink">
              ✍️ Write
            </NavLink>
            {me.role === 'admin' && (
              <NavLink to="/admin" className="navlink">
                Admin
              </NavLink>
            )}
            <NavLink to={`/app/u/${me.handle}`} className="navlink" aria-label="Your profile" title={me.displayName ?? 'Profile'}>
              <Avatar name={me.displayName ?? '?'} emoji={me.avatar} />
            </NavLink>
            <button
              type="button"
              className="navlink"
              style={{ background: 'none', border: 0 }}
              onClick={async () => {
                await auth.logout();
                nav('/', { replace: true });
              }}
            >
              Sign out
            </button>
          </nav>
        </div>
      </header>
      <Outlet />
    </>
  );
}
