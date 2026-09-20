import { useState } from 'react';
import { Link, NavLink, useNavigate } from 'react-router';
import { auth, type Me } from '../api/types';
import { Avatar, Sheet } from './ui';

/**
 * Phone navigation: a fixed bottom tab bar, thumb-reachable. Four destinations and a raised
 * "create" button in the middle. "Me" opens a sheet with the rest (profile, books, settings…).
 * Hidden by CSS above 767px, where the top-bar tabs take over.
 */
export function BottomBar({ me, unread }: { me: Me; unread: number }) {
  const nav = useNavigate();
  const [sheet, setSheet] = useState<'create' | 'me' | null>(null);
  const close = () => setSheet(null);

  return (
    <>
      <nav className="tabbar" aria-label="Main">
        <NavLink to="/app" end className="tabbar-item">
          <span className="tabbar-icon" aria-hidden="true">📣</span>
          <span className="tabbar-label">Feed</span>
        </NavLink>
        <NavLink to="/app/cook" className="tabbar-item">
          <span className="tabbar-icon" aria-hidden="true">🥘</span>
          <span className="tabbar-label">Cook</span>
        </NavLink>
        <button type="button" className="tabbar-item tabbar-create" aria-label="Create" aria-haspopup="dialog" aria-expanded={sheet === 'create'} onClick={() => setSheet('create')}>
          <span className="tabbar-plus" aria-hidden="true">＋</span>
          <span className="tabbar-label">Create</span>
        </button>
        <NavLink to="/app/shop" className="tabbar-item">
          <span className="tabbar-icon" aria-hidden="true">🛍️</span>
          <span className="tabbar-label">Shop</span>
        </NavLink>
        <button type="button" className={`tabbar-item${sheet === 'me' ? ' is-open' : ''}`} aria-label="You" aria-haspopup="dialog" aria-expanded={sheet === 'me'} onClick={() => setSheet('me')}>
          <span className="tabbar-icon tabbar-avatar" aria-hidden="true">
            <Avatar name={me.displayName ?? '?'} emoji={me.avatar} />
            {unread > 0 && <span className="tabbar-dot" />}
          </span>
          <span className="tabbar-label">Me</span>
        </button>
      </nav>

      <Sheet open={sheet === 'create'} onClose={close} title="What are we making?">
        <div className="sheet-actions">
          <Link to="/app?share=1" className="sheet-action" onClick={close}>
            <span aria-hidden="true">📣</span>
            <span>
              <b>Share a recipe</b>
              <small>Post one of yours to the feed</small>
            </span>
          </Link>
          <Link to="/app/cook" className="sheet-action" onClick={close}>
            <span aria-hidden="true">✨</span>
            <span>
              <b>Ask the AI</b>
              <small>Describe what you feel like, or pick ingredients</small>
            </span>
          </Link>
          <Link to="/app/recipes/new" className="sheet-action" onClick={close}>
            <span aria-hidden="true">🍽️</span>
            <span>
              <b>Write a recipe</b>
              <small>By hand, with the ingredient library</small>
            </span>
          </Link>
          <Link to="/app/blog/new" className="sheet-action" onClick={close}>
            <span aria-hidden="true">📓</span>
            <span>
              <b>Write a blog post</b>
              <small>A story, a technique, a week of cooking</small>
            </span>
          </Link>
          <Link to="/app/shop/new" className="sheet-action" onClick={close}>
            <span aria-hidden="true">🛍️</span>
            <span>
              <b>Sell something</b>
              <small>Gear, jars, books, classes — reviewed before it goes live</small>
            </span>
          </Link>
        </div>
      </Sheet>

      <Sheet open={sheet === 'me'} onClose={close} title={me.displayName ?? me.handle}>
        <div className="sheet-actions">
          <Link to={`/app/u/${me.handle}`} className="sheet-action" onClick={close}>
            <span aria-hidden="true">🧑‍🍳</span>
            <span>
              <b>Your profile</b>
              <small>@{me.handle}</small>
            </span>
          </Link>
          <Link to="/app/blog" className="sheet-action" onClick={close}>
            <span aria-hidden="true">📓</span>
            <span>
              <b>Blog</b>
            </span>
          </Link>
          <Link to="/app/books" className="sheet-action" onClick={close}>
            <span aria-hidden="true">📚</span>
            <span>
              <b>Recipe books</b>
            </span>
          </Link>
          <Link to="/app/plan" className="sheet-action" onClick={close}>
            <span aria-hidden="true">📅</span>
            <span>
              <b>Meal plan</b>
              <small>Your week, meal by meal; prep days; one tap to the shopping list</small>
            </span>
          </Link>
          <Link to="/app/list" className="sheet-action" onClick={close}>
            <span aria-hidden="true">🛒</span>
            <span>
              <b>Shopping list</b>
              <small>Fills itself from recipes; tick things off in the store</small>
            </span>
          </Link>
          <Link to="/app/shop/mine" className="sheet-action" onClick={close}>
            <span aria-hidden="true">🛍️</span>
            <span>
              <b>Your shop</b>
              <small>Listings, orders to send, purchases</small>
            </span>
          </Link>
          <Link to="/app/notifications" className="sheet-action" onClick={close}>
            <span aria-hidden="true">🔔</span>
            <span>
              <b>Notifications</b>
              {unread > 0 && <small>{unread} unread</small>}
            </span>
          </Link>
          <Link to="/app/sales" className="sheet-action" onClick={close}>
            <span aria-hidden="true">💵</span>
            <span>
              <b>Sales & payouts</b>
              <small>Books you’ve sold, promotions, balance</small>
            </span>
          </Link>
          <Link to="/app/settings" className="sheet-action" onClick={close}>
            <span aria-hidden="true">⚙️</span>
            <span>
              <b>Settings</b>
              <small>Answers, profile, AI keys, account</small>
            </span>
          </Link>
          {me.role === 'admin' && (
            <Link to="/admin" className="sheet-action" onClick={close}>
              <span aria-hidden="true">🛠</span>
              <span>
                <b>Admin</b>
              </span>
            </Link>
          )}
          <button
            type="button"
            className="sheet-action"
            onClick={async () => {
              close();
              await auth.logout();
              nav('/', { replace: true });
            }}
          >
            <span aria-hidden="true">👋</span>
            <span>
              <b>Sign out</b>
            </span>
          </button>
        </div>
      </Sheet>
    </>
  );
}
