import type {
  AdminStats,
  AdminUser,
  AppSettings,
  AuditEntry,
  AuthProviderInfo,
  Comment,
  GenerationLog,
  Me,
  MediaItem,
  Post,
  Profile,
  PublicProfile,
  Recipe,
  RecipeSummary,
} from '@foodi/shared';
import { api, ApiError } from './client';

export type { AdminStats, AdminUser, AppSettings, AuditEntry, AuthProviderInfo, Comment, GenerationLog, Me, MediaItem, Post, Profile, PublicProfile, Recipe, RecipeSummary };

export const auth = {
  providers: () => api<{ providers: AuthProviderInfo[]; allowSignups: boolean; maintenanceMessage: string }>('/auth/providers'),
  me: () => api<Me>('/auth/me'),
  connectKey: (vendor: 'openai' | 'anthropic', apiKey: string) => api<Me>('/auth/key', { method: 'POST', body: { vendor, apiKey } }),
  logout: () => api<{ ok: true }>('/auth/logout', { method: 'POST' }),
  logoutEverywhere: () => api<{ ok: true }>('/auth/logout-everywhere', { method: 'POST' }),
  deleteAccount: () => api<{ ok: true }>('/auth/account', { method: 'DELETE' }),
};

export const profile = {
  get: () => api<{ profile: Profile | null }>('/profile'),
  save: (p: Profile) => api<{ profile: Profile }>('/profile', { method: 'PUT', body: p }),
  pantry: () => api<{ ingredientIds: string[] }>('/profile/pantry'),
  savePantry: (ingredientIds: string[]) => api<{ ingredientIds: string[] }>('/profile/pantry', { method: 'PUT', body: { ingredientIds } }),
};

export interface RecipeDetail {
  recipe: Recipe;
  isMine: boolean;
  source: 'ai' | 'user';
  visibility: 'private' | 'public';
  author: { handle: string; displayName: string; avatar: string } | null;
}

export const recipes = {
  list: () => api<{ recipes: RecipeSummary[] }>('/recipes'),
  get: (id: string) => api<RecipeDetail>(`/recipes/${encodeURIComponent(id)}`),
  generate: (body: { prompt: string; ingredientIds: string[]; basedOnRecipeId?: string; servings?: number; timeBudgetMinutes?: number; mealType?: string; avoidTitles?: string[]; seed?: string }) =>
    api<{ recipe: Recipe }>('/recipes/generate', { method: 'POST', body }),
  create: (body: unknown) => api<{ recipe: Recipe }>('/recipes', { method: 'POST', body }),
  update: (id: string, body: unknown) => api<{ recipe: Recipe }>(`/recipes/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  favorite: (id: string, favorite: boolean) => api<{ favorite: boolean }>(`/recipes/${encodeURIComponent(id)}/favorite`, { method: 'POST', body: { favorite } }),
  save: (id: string) => api<{ id: string }>(`/recipes/${encodeURIComponent(id)}/save`, { method: 'POST' }),
  remove: (id: string) => api<{ ok: true }>(`/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
};

export const social = {
  feed: (before?: string) => api<{ posts: Post[]; nextBefore: string | null }>(`/social/feed${before ? `?before=${encodeURIComponent(before)}` : ''}`),
  post: (id: string) => api<{ post: Post; comments: Comment[] }>(`/social/posts/${encodeURIComponent(id)}`),
  createPost: (recipeId: string, caption: string, mediaIds: string[] = []) => api<{ post: Post }>('/social/posts', { method: 'POST', body: { recipeId, caption, mediaIds } }),
  deletePost: (id: string) => api<{ ok: true }>(`/social/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  like: (id: string, liked: boolean) => api<{ liked: boolean; likeCount: number }>(`/social/posts/${encodeURIComponent(id)}/like`, { method: 'POST', body: { liked } }),
  comment: (id: string, body: string) => api<{ comment: Comment }>(`/social/posts/${encodeURIComponent(id)}/comments`, { method: 'POST', body: { body } }),
  deleteComment: (id: string) => api<{ ok: true }>(`/social/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  profile: (handle: string) => api<{ profile: PublicProfile; posts: Post[] }>(`/social/profiles/${encodeURIComponent(handle)}`),
  myProfile: () => api<{ profile: PublicProfile }>('/social/profile'),
  updateProfile: (handle: string, bio: string, avatar: string) => api<{ profile: PublicProfile }>('/social/profile', { method: 'PUT', body: { handle, bio, avatar } }),
};

export const media = {
  url: (id: string) => `/api/media/${encodeURIComponent(id)}`,
  mine: () => api<{ media: MediaItem[]; usedBytes: number; capBytes: number }>('/media'),
  remove: (id: string) => api<{ ok: true }>(`/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  /** Raw-body upload with progress (fetch can't report upload progress). */
  upload: (file: File, opts: { recipeId?: string; onProgress?: (fraction: number) => void; signal?: AbortSignal } = {}) =>
    new Promise<MediaItem>((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const url = `/api/media${opts.recipeId ? `?recipeId=${encodeURIComponent(opts.recipeId)}` : ''}`;
      xhr.open('POST', url);
      xhr.setRequestHeader('content-type', file.type || 'application/octet-stream');
      xhr.setRequestHeader('accept', 'application/json');
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) opts.onProgress?.(e.loaded / e.total);
      };
      xhr.onerror = () => reject(new ApiError(0, 'network', 'Upload failed. Check your connection and try again.'));
      xhr.onload = () => {
        let data: { media?: MediaItem; error?: { code?: string; message?: string } } = {};
        try {
          data = JSON.parse(xhr.responseText);
        } catch {
          /* fallthrough */
        }
        if (xhr.status >= 200 && xhr.status < 300 && data.media) resolve(data.media);
        else reject(new ApiError(xhr.status, data.error?.code ?? 'upload_failed', data.error?.message ?? `Upload failed (${xhr.status})`));
      };
      opts.signal?.addEventListener('abort', () => xhr.abort());
      xhr.send(file);
    }),
};

export interface AdminUserDetail {
  user: AdminUser & { handle: string };
  identities: { provider: string; email: string | null; created_at: string }[];
  recipes: { id: string; title: string; source: string; visibility: string; created_at: string }[];
  generations: GenerationLog[];
}

export const admin = {
  stats: () => api<AdminStats>('/admin/stats'),
  users: (q?: string) => api<{ users: (AdminUser & { handle: string })[] }>(`/admin/users${q ? `?q=${encodeURIComponent(q)}` : ''}`),
  user: (id: string) => api<AdminUserDetail>(`/admin/users/${encodeURIComponent(id)}`),
  updateUser: (id: string, body: { role?: 'admin' | 'consumer'; disabled?: boolean }) => api<{ user: AdminUser }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  revokeSessions: (id: string) => api<{ ok: true }>(`/admin/users/${encodeURIComponent(id)}/revoke-sessions`, { method: 'POST' }),
  deleteUser: (id: string) => api<{ ok: true }>(`/admin/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  recipes: (q?: string) =>
    api<{ recipes: { id: string; title: string; source: string; visibility: string; provider: string; createdAt: string; userId: string; handle: string; totalMinutes: number; ingredientCount: number; allergens: string[] }[] }>(
      `/admin/recipes${q ? `?q=${encodeURIComponent(q)}` : ''}`,
    ),
  deleteRecipe: (id: string) => api<{ ok: true }>(`/admin/recipes/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  posts: () => api<{ posts: { id: string; caption: string; createdAt: string; authorId: string; handle: string; recipeTitle: string; likeCount: number; commentCount: number }[] }>('/admin/posts'),
  deletePost: (id: string) => api<{ ok: true }>(`/admin/posts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  comments: () => api<{ comments: { id: string; body: string; createdAt: string; authorId: string; handle: string; postId: string }[] }>('/admin/comments'),
  deleteComment: (id: string) => api<{ ok: true }>(`/admin/comments/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  generations: (status?: 'ok' | 'failed') => api<{ generations: GenerationLog[] }>(`/admin/generations${status ? `?status=${status}` : ''}`),
  settings: () =>
    api<{ settings: AppSettings; server: { env: string; providers: string[]; mockEnabled: boolean; models: { anthropic: string; openai: string }; uploadDir: string; bootstrapFirstAdmin: boolean; adminEmails: string[]; cookieSecure: boolean } }>('/admin/settings'),
  updateSettings: (patch: Partial<AppSettings>) => api<{ settings: AppSettings }>('/admin/settings', { method: 'PUT', body: patch }),
  audit: () => api<{ entries: AuditEntry[] }>('/admin/audit'),
  media: () => api<{ media: { id: string; ownerId: string; handle: string; kind: string; mime: string; bytes: number; recipeId: string | null; postId: string | null; createdAt: string }[] }>('/admin/media'),
  deleteMedia: (id: string) => api<{ ok: true }>(`/admin/media/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  purgeSessions: () => api<{ ok: true }>('/admin/maintenance/purge-sessions', { method: 'POST' }),
};
