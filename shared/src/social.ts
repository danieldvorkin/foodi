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
  followerCount: z.number(),
  followingCount: z.number(),
  blogCount: z.number(),
  bookCount: z.number(),
  isMe: z.boolean(),
  followedByMe: z.boolean(),
  followsMe: z.boolean(),
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
    adaptedFrom: z.object({ id: z.string().nullable(), title: z.string(), handle: z.string() }).nullable(),
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

/** Editing an authored (or adapted) recipe may also update the notes on what changed. */
export const EditRecipeSchema = AuthoredRecipeSchema.extend({
  revisionNotes: z.string().trim().max(2000).optional(),
});

export const NOTIFICATION_KINDS = ['like', 'comment', 'save', 'role', 'system', 'follow', 'book', 'remix', 'post'] as const;
export const NotificationSchema = z.object({
  id: z.string(),
  kind: z.enum(NOTIFICATION_KINDS),
  actor: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }).nullable(),
  postId: z.string().nullable(),
  recipeId: z.string().nullable(),
  recipeTitle: z.string().nullable(),
  blogId: z.string().nullable(),
  blogTitle: z.string().nullable(),
  bookId: z.string().nullable(),
  bookName: z.string().nullable(),
  message: z.string().nullable(),
  readAt: z.string().nullable(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

// ---- people -------------------------------------------------------------------------------
export const PersonSchema = z.object({
  id: z.string(),
  handle: z.string(),
  displayName: z.string(),
  avatar: z.string(),
  bio: z.string(),
  followerCount: z.number(),
  followedByMe: z.boolean(),
  isMe: z.boolean(),
});
export type Person = z.infer<typeof PersonSchema>;

// ---- blog ---------------------------------------------------------------------------------
export const BLOG_STATUS = ['draft', 'published'] as const;

export const BlogRecipeRefSchema = z.object({
  id: z.string(),
  emoji: z.string(),
  title: z.string(),
  totalMinutes: z.number(),
  difficulty: z.enum(DIFFICULTY),
});

export const BlogPostSchema = z.object({
  id: z.string(),
  title: z.string(),
  /** Plain text with light markdown: paragraphs, "## " headings, "- " lists, **bold**, _italic_, [links](https://…). */
  body: z.string(),
  excerpt: z.string(),
  status: z.enum(BLOG_STATUS),
  readingMinutes: z.number(),
  author: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }),
  cover: MediaItemSchema.nullable(),
  media: z.array(MediaItemSchema),
  recipes: z.array(BlogRecipeRefSchema),
  likeCount: z.number(),
  commentCount: z.number(),
  likedByMe: z.boolean(),
  isMine: z.boolean(),
  publishedAt: z.string().nullable(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type BlogPost = z.infer<typeof BlogPostSchema>;

export const UpsertBlogPostSchema = z.object({
  title: z.string().trim().min(1, 'Give it a title').max(120),
  body: z.string().trim().min(1, 'Write something first').max(20000),
  status: z.enum(BLOG_STATUS).default('published'),
  recipeIds: z.array(z.string().min(1)).max(6).default([]),
  mediaIds: z.array(z.string().min(1)).max(8).default([]),
  coverMediaId: z.string().min(1).nullable().default(null),
});

// ---- feed ---------------------------------------------------------------------------------
export const FEED_SCOPES = ['everyone', 'following'] as const;
export type FeedScope = (typeof FEED_SCOPES)[number];

export const FeedItemSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('post'), createdAt: z.string(), post: PostSchema }),
  z.object({ type: z.literal('blog'), createdAt: z.string(), blog: BlogPostSchema }),
]);
export type FeedItem = z.infer<typeof FeedItemSchema>;

// ---- recipe books -------------------------------------------------------------------------
export const BOOK_EMOJI = ['📚', '📕', '📗', '📘', '📙', '📒', '🍝', '🥗', '🍰', '🍲', '🌮', '🍱', '🥖', '🧁', '🍳', '🎄', '🎃', '🏕️', '🎉', '💪'] as const;

export const RecipeBookSchema = z.object({
  id: z.string(),
  name: z.string(),
  emoji: z.string(),
  description: z.string(),
  visibility: z.enum(['private', 'public']),
  owner: z.object({ id: z.string(), handle: z.string(), displayName: z.string(), avatar: z.string() }),
  recipeCount: z.number(),
  /** Emoji of the first few recipes, for the spine. */
  peek: z.array(z.string()),
  isMine: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type RecipeBook = z.infer<typeof RecipeBookSchema>;

export const BookItemSchema = z.object({
  recipeId: z.string(),
  emoji: z.string(),
  title: z.string(),
  summary: z.string(),
  totalMinutes: z.number(),
  difficulty: z.enum(DIFFICULTY),
  mealType: z.enum(MEAL_TYPES),
  cover: MediaItemSchema.nullable(),
  author: z.object({ handle: z.string(), displayName: z.string() }),
  note: z.string(),
  addedAt: z.string(),
  /** False when the recipe went private since it was added; the owner still sees it. */
  available: z.boolean(),
});
export type BookItem = z.infer<typeof BookItemSchema>;

export const UpsertBookSchema = z.object({
  name: z.string().trim().min(1, 'Name the book').max(60),
  emoji: z.string().trim().min(1).max(8).default('📚'),
  description: z.string().trim().max(300).default(''),
  visibility: z.enum(['private', 'public']).default('public'),
});

export const AddBookItemSchema = z.object({
  recipeId: z.string().min(1),
  note: z.string().trim().max(300).default(''),
});
