import { z } from 'zod';

/** Work that runs after the request has already returned: today, writing a recipe. */
export const JOB_KINDS = ['generate', 'image', 'provision'] as const;
export const JOB_STATUS = ['queued', 'running', 'done', 'failed', 'cancelled'] as const;

export const JobSchema = z.object({
  id: z.string(),
  kind: z.enum(JOB_KINDS),
  status: z.enum(JOB_STATUS),
  /** What was asked for, for the "Writing…" card. */
  prompt: z.string(),
  attempts: z.number(),
  maxAttempts: z.number(),
  lastError: z.string().nullable(),
  lastErrorCode: z.string().nullable(),
  /** Set when done. */
  recipeId: z.string().nullable(),
  recipeTitle: z.string().nullable(),
  createdAt: z.string(),
  runAfter: z.string(),
  startedAt: z.string().nullable(),
  finishedAt: z.string().nullable(),
});
export type Job = z.infer<typeof JobSchema>;

export const ACTIVE_JOB_STATUS = ['queued', 'running'] as const;
