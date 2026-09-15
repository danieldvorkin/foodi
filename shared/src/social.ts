import { z } from 'zod';
import { DIFFICULTY, MEAL_TYPES, MediaItemSchema, RecipeContentSchema } from './recipe.js';

export const HANDLE_RE = /^[a-z0-9_]{3,20}$/;

export const AVATAR_EMOJI = ['🧑‍🍳', '👩‍🍳', '👨‍🍳', '🥑', '🌶️', '🍋', '🍄', '🧄', '🥐', '🍜', '🍣', '🌮', '🍕', '🥞', '🍩', '🫐', '🥦', '🍤', '🧀', '🍯'] as const;

export const PublicProfileSchema = z.object({
  id: z.string(),
  handle: z.string(),
  displayName: z.string(),
  avatar: z.string(),
  bio: z.string(),
  createdAt: z.string(),
  postCount: z.number(),
  likeCount: z.number(),
  isMe: z.boolean(),
});
export type PublicProfile = z.infer<typeof PublicProfileSchema>;

export const UpdateSocialProfileSchema = z.object({
  handle: z.string().trim().toLowerCase().regex(HANDLE_RE, 'Use 3–20 letters, numbers or underscores'),
  bio: z.string().trim().max(240),
  avatar: z.string().trim().min(1).max(8),
});

export const PostSchema = z.object({
  id: z.string(),
  caption: z.string(),
  createdAt: z.string(),
  author: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }),
  media: z.array(MediaItemSchema),
  recipe: z.object({
    id: z.string(),
    emoji: z.string(),
    cover: MediaItemSchema.nullable(),
    title: z.string(),
    summary: z.string(),
    mealType: z.enum(MEAL_TYPES),
    totalMinutes: z.number(),
    difficulty: z.enum(DIFFICULTY),
    servings: z.number(),
    source: z.enum(['ai', 'user']),
    ingredientCount: z.number(),
  }),
  likeCount: z.number(),
  commentCount: z.number(),
  likedByMe: z.boolean(),
  isMine: z.boolean(),
});
export type Post = z.infer<typeof PostSchema>;

export const CommentSchema = z.object({
  id: z.string(),
  body: z.string(),
  createdAt: z.string(),
  author: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }),
  isMine: z.boolean(),
});
export type Comment = z.infer<typeof CommentSchema>;

export const CreatePostSchema = z.object({
  recipeId: z.string().min(1),
  caption: z.string().trim().max(1000),
  mediaIds: z.array(z.string().min(1)).max(6).default([]),
});

export const CreateCommentSchema = z.object({
  body: z.string().trim().min(1).max(500),
});

/** A recipe a person writes themselves. Same shape as the model output, but the editor
 *  lets most fields be blank, so we relax the required-ness here and fill defaults server-side. */
export const AuthoredRecipeSchema = RecipeContentSchema.partial({
  cuisine: true,
  dietLabels: true,
  tags: true,
  allergens: true,
  equipment: true,
  techniques: true,
  substitutions: true,
  makeAhead: true,
  storage: true,
  nutritionPerServing: true,
}).extend({
  summary: z.string().trim().max(400),
  activeMinutes: z.number().int().min(0).max(24 * 60),
});
export type AuthoredRecipe = z.infer<typeof AuthoredRecipeSchema>;

export const NOTIFICATION_KINDS = ['like', 'comment', 'save', 'role', 'system'] as const;
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  actor: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }).nullable(),
  postId: z.string().nullable(),
  recipeId: z.string().nullable(),
  recipeTitle: z.string().nullable(),
  message: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;
