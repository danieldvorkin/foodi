import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { Notification } from '@foodi/shared';
import { NotificationBell, describe as describeNotification } from '../Notifications';
import { renderWithRouter, stubApi } from '../../test/helpers';

const n = (over: Partial<Notification> = {}): Notification => ({
  id: 'ntf_1',
  kind: 'follow',
  actor: { id: 'u2', handle: 'sam', displayName: 'Sam', avatar: '🥑' },
  postId: null,
  recipeId: null,
  recipeTitle: null,
  blogId: null,
  blogTitle: null,
  bookId: null,
  bookName: null,
  message: null,
  readAt: null,
  createdAt: new Date().toISOString(),
  ...over,
});

describe('NotificationBell', () => {
  it('shows the count, caps at 99+, hides at zero, and lists items when opened', async () => {
    const calls = stubApi({ 'GET /api/notifications': { unread: 1, notifications: [n()] }, 'POST /api/notifications/read': { unread: 0 } });
    const setUnread = vi.fn();
    const zero = renderWithRouter(<NotificationBell unread={0} setUnread={setUnread} latest={null} />);
    expect(screen.queryByText('0')).toBeNull();
    expect(screen.getByRole('button', { name: 'Notifications' })).toBeInTheDocument();
    zero.unmount();
    renderWithRouter(<NotificationBell unread={120} setUnread={setUnread} latest={null} />);
    expect(screen.getByText('99+')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Notifications, 120 unread/ })).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Notifications/ }));
    expect(await screen.findByText(/Sam started following you/)).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'GET' && c.url.endsWith('/api/notifications'))).toBe(true);
  });

  it('describes every kind with a destination', () => {
    expect(describeNotification(n({ kind: 'like', postId: 'p1', recipeTitle: 'Tacos' }))).toEqual({ text: 'Sam liked your post about “Tacos”', to: '/app/posts/p1' });
    expect(describeNotification(n({ kind: 'sale', bookId: 'b1', message: 'bought “Weeknights”' })).to).toBe('/app/sales');
    expect(describeNotification(n({ kind: 'system', actor: null, message: 'Maintenance tonight' }))).toEqual({ text: 'Maintenance tonight', to: null });
  });
});
