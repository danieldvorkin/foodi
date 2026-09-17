import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Comment, Post } from '@foodi/shared';
import { PostCard } from '../PostCard';
import { renderWithRouter, stubApi } from '../../test/helpers';

const jo = { id: 'u2', handle: 'jo', displayName: 'Jo', avatar: '🧑‍🍳' };
const comment = (id: string, body: string, over: Partial<Comment> = {}): Comment => ({ id, body, createdAt: new Date().toISOString(), author: jo, isMine: false, ...over });

const post = (over: Partial<Post> = {}): Post => ({
  id: 'pst_1',
  caption: 'Made this tonight',
  createdAt: new Date().toISOString(),
  author: { id: 'u1', handle: 'foodi', displayName: 'foodi kitchen', avatar: '🥘' },
  media: [],
  recipe: { id: 'rcp_1', emoji: '🌮', cover: null, title: 'Tacos', summary: 'Quick tacos', mealType: 'dinner', totalMinutes: 20, difficulty: 'easy', servings: 2, source: 'user', ingredientCount: 8, dietLabels: ['gluten-free'], adaptedFrom: null },
  likeCount: 3,
  commentCount: 0,
  likedByMe: false,
  isMine: false,
  isHouse: true,
  commentsEnabled: false,
  latestComments: [],
  ...over,
});


describe('PostCard', () => {
  it('leads with the dish: the title sits on the hero and links to the recipe; house recipes have comments off', () => {
    renderWithRouter(<PostCard post={post()} />);
    const hero = screen.getByRole('link', { name: /Tacos.*20 min/ });
    expect(hero).toHaveAttribute('href', '/app/recipes/rcp_1');
    expect(screen.getByText(/house recipe/)).toBeInTheDocument();
    expect(screen.getByText('gluten-free')).toBeInTheDocument();
    expect(screen.getByTitle('Comments are off on house recipes')).toBeInTheDocument();
    expect(screen.queryByLabelText('Add a comment')).toBeNull();
    expect(screen.getByRole('link', { name: 'Cook this →' })).toHaveAttribute('href', '/app/recipes/rcp_1');
  });

  it('shows the newest comments inline, expands to the whole thread, and posts a new one on Enter', async () => {
    const calls = stubApi({
      'GET /api/social/posts/pst_1/comments': { comments: [comment('c1', 'First'), comment('c2', 'Second'), comment('c3', 'Third')] },
      'POST /api/social/posts/pst_1/comments': { comment: comment('c4', 'Looks great', { isMine: true, author: { id: 'me', handle: 'me', displayName: 'Me', avatar: '🙂' } }) },
    });
    renderWithRouter(<PostCard post={post({ isHouse: false, commentsEnabled: true, commentCount: 3, latestComments: [comment('c2', 'Second'), comment('c3', 'Third')] })} />);
    const thread = screen.getByRole('region', { name: 'Comments' });
    expect(within(thread).getByText('Second')).toBeInTheDocument();
    expect(within(thread).queryByText('First')).toBeNull();

    const user = userEvent.setup();
    await user.click(within(thread).getByRole('button', { name: 'View all 3 comments' }));
    expect(await within(thread).findByText('First')).toBeInTheDocument();
    expect(within(thread).queryByRole('button', { name: /View all/ })).toBeNull();

    await user.type(screen.getByLabelText('Add a comment'), 'Looks great{Enter}');
    expect(await within(thread).findByText('Looks great')).toBeInTheDocument();
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ body: 'Looks great' });
    expect(screen.getByRole('button', { name: '4 comments' })).toBeInTheDocument();
    // Own comment can be deleted.
    expect(within(thread).getAllByRole('button', { name: 'Delete comment' })).toHaveLength(1);
  });

  it('shares the recipe link (clipboard fallback when the browser has no share sheet) and saves a copy', async () => {
    stubApi({ 'POST /api/recipes/rcp_1/save': { id: 'rcp_copy' } });
    renderWithRouter(<PostCard post={post({ isHouse: false, commentsEnabled: true })} />);
    // user-event installs a working fake clipboard; jsdom has no navigator.share.
    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: /Share/ }));
    await waitFor(async () => expect(await navigator.clipboard.readText()).toMatch(/\/app\/recipes\/rcp_1$/));
    await user.click(screen.getByRole('button', { name: /Save/ }));
    expect(await screen.findByRole('link', { name: /Saved/ })).toHaveAttribute('href', '/app/recipes/rcp_copy');
  });

  it('credits adapted recipes and hides Save on your own post', () => {
    renderWithRouter(<PostCard post={post({ isMine: true, isHouse: false, commentsEnabled: true, recipe: { ...post().recipe, adaptedFrom: { id: 'rcp_0', title: 'Original tacos', handle: 'ada' } } })} />);
    expect(screen.getByText(/Adapted from “Original tacos” by @ada/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Save/ })).toBeNull();
  });
});
