import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FollowButton } from '../People';
import { apiError, renderWithRouter, stubApi } from '../../test/helpers';

describe('FollowButton', () => {
  it('toggles optimistically and reports the new follower count', async () => {
    const calls = stubApi({ 'POST /api/social/follow/ada': { following: true, followerCount: 4 } });
    const counts: number[] = [];
    renderWithRouter(<FollowButton handle="ada" following={false} onChange={(_f, c) => counts.push(c)} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Follow' }));
    expect(screen.getByRole('button', { name: 'Following' })).toHaveAttribute('aria-pressed', 'true');
    await waitFor(() => expect(counts).toEqual([4]));
    expect(calls[0]?.body).toEqual({ follow: true });
  });

  it('reverts when the server refuses', async () => {
    stubApi({ 'POST /api/social/follow/ada': apiError(400, 'You can’t follow yourself.') });
    renderWithRouter(<FollowButton handle="ada" following={false} />);
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Follow' }));
    await waitFor(() => expect(screen.getByRole('button', { name: 'Follow' })).toHaveAttribute('aria-pressed', 'false'));
    expect(await screen.findByText('You can’t follow yourself.')).toBeInTheDocument();
  });
});
