import { Link, NavLink, Outlet, useLoaderData, useNavigate, useRouteLoaderData, type LoaderFunctionArgs } from 'react-router';
import { auth, type Me } from '../../api/types';
import { Wordmark } from '../../components/Logo';
import { Avatar, Menu } from '../../components/ui';
import { NotificationBell, useUnread } from '../../components/Notifications';
import { BottomBar } from '../../components/MobileNav';
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

function Tab({ to, end, icon, label }: { to: string; end?: boolean; icon: string; label: string }) {
  return (
    <NavLink to={to} end={Boolean(end)} className="tab">
      <span className="tab-icon" aria-hidden="true">
        {icon}
      </span>
      <span className="tab-label">{label}</span>
    </NavLink>
  );
}

export function AppLayout() {
  const { me } = useLoaderData<typeof appLoader>();
  const nav = useNavigate();
  const { unread, setUnread, latest } = useUnread();
  return (
    <>
      <header className="topbar">
        <div className="topbar-inner">
          <Wordmark to="/app" />
          <nav className="tabs" aria-label="Main">
            <Tab to="/app" end icon="📣" label="Feed" />
            <Tab to="/app/cook" icon="🥘" label="Cook" />
            <Tab to="/app/blog" icon="📓" label="Blog" />
            <Tab to="/app/books" icon="📚" label="Books" />
            <Tab to="/app/shop" icon="🛍️" label="Shop" />
          </nav>
          <div className="topbar-actions">
            <Menu label="Write" button={<span className="iconbtn iconbtn-label"><span aria-hidden="true">✍️</span><span className="tab-label">Write</span></span>}>
              <Link to="/app/recipes/new" className="panel-item" role="menuitem">
                🍽️ A recipe
              </Link>
              <Link to="/app/blog/new" className="panel-item" role="menuitem">
                📓 A blog post
              </Link>
              <Link to="/app/cook" className="panel-item" role="menuitem">
                ✨ Ask the AI for one
              </Link>
              <Link to="/app/shop/new" className="panel-item" role="menuitem">
                🛍️ Sell something
              </Link>
            </Menu>
            <NotificationBell unread={unread} setUnread={setUnread} latest={latest} />
            <Menu label="Your account" button={<Avatar name={me.displayName ?? '?'} emoji={me.avatar} />}>
              <div className="panel-item panel-item-static">
                <Avatar name={me.displayName ?? '?'} emoji={me.avatar} />
                <div style={{ minWidth: 0 }}>
                  <p className="small" style={{ fontWeight: 500 }}>
                    {me.displayName ?? me.handle}
                  </p>
                  <p className="muted tiny">@{me.handle}</p>
                </div>
              </div>
              <Link to={`/app/u/${me.handle}`} className="panel-item" role="menuitem">
                🧑‍🍳 Your profile
              </Link>
              <Link to="/app/books" className="panel-item" role="menuitem">
                📚 Your recipe books
              </Link>
              <Link to="/app/list" className="panel-item" role="menuitem">
                🛒 Shopping list
              </Link>
              <Link to="/app/notifications" className="panel-item" role="menuitem">
                🔔 Notifications
              </Link>
              <Link to="/app/shop/mine" className="panel-item" role="menuitem">
                🛍️ Your shop
              </Link>
              <Link to="/app/sales" className="panel-item" role="menuitem">
                💵 Sales & payouts
              </Link>
              <Link to="/app/settings" className="panel-item" role="menuitem">
                ⚙️ Settings
              </Link>
              {me.role === 'admin' && (
                <Link to="/admin" className="panel-item" role="menuitem">
                  🛠 Admin
                </Link>
              )}
              <button
                type="button"
                className="panel-item panel-item-btn"
                role="menuitem"
                onClick={async () => {
                  await auth.logout();
                  nav('/', { replace: true });
                }}
              >
                👋 Sign out
              </button>
            </Menu>
          </div>
        </div>
      </header>
      <Outlet />
      <BottomBar me={me} unread={unread} />
    </>
  );
}
