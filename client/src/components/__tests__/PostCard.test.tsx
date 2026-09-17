import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Post } from '@foodi/shared';
import { PostCard } from '../PostCard';
import { renderWithRouter } from '../../test/helpers';

const post = (over: Partial<Post> = {}): Post => ({
  id: 'pst_1',
  caption: 'Made this tonight',
  createdAt: new Date().toISOString(),
  author: { id: 'u1', handle: 'foodi', displayName: 'foodi kitchen', avatar: '🥘' },
  media: [],
  recipe: { id: 'rcp_1', emoji: '🌮', cover: null, title: 'Tacos', summary: 'Quick tacos', mealType: 'dinner', totalMinutes: 20, difficulty: 'easy', servings: 2, source: 'user', ingredientCount: 8, adaptedFrom: null },
  likeCount: 3,
  commentCount: 2,
  likedByMe: false,
  isMine: false,
  isHouse: true,
  commentsEnabled: false,
  ...over,
});

describe('PostCard', () => {
  it('labels house recipes and turns comments off for them', () => {
    renderWithRouter(<PostCard post={post()} />);
    expect(screen.getByText(/house recipe/)).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /comments?$/ })).toBeNull();
    expect(screen.getByTitle('Comments are off on house recipes')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Save/ })).toHaveAttribute('href', '/app/recipes/rcp_1');
  });

  it('links to the comment thread for ordinary posts and credits adapted recipes', () => {
    renderWithRouter(<PostCard post={post({ isHouse: false, commentsEnabled: true, recipe: { ...post().recipe, adaptedFrom: { id: 'rcp_0', title: 'Original tacos', handle: 'ada' } } })} />);
    expect(screen.getByRole('link', { name: '💬 2 comments' })).toHaveAttribute('href', '/app/posts/pst_1');
    expect(screen.getByText(/Adapted from “Original tacos” by @ada/)).toBeInTheDocument();
  });
});
