import type { ZodType } from 'zod';

/** Parse or throw a ZodError (turned into a 400 by the error handler). */
export function parse<T>(schema: ZodType<T>, input: unknown): T {
  return schema.parse(input);
}
