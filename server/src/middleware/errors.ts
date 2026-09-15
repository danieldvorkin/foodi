import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import type { Logger } from '../lib/logger.js';

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'not_found', message: `No route for ${req.method} ${req.path}` } });
}

export function errorHandler(log: Logger) {
  return (err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof ZodError) {
      res.status(400).json({
        error: {
          code: 'validation',
          message: 'Some fields need attention.',
          details: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      });
      return;
    }
    if (err instanceof HttpError) {
      if (err.status >= 500) log.error({ err, requestId: req.requestId }, err.message);
      res.status(err.status).json({ error: { code: err.code, message: err.message, ...(err.details ? { details: err.details } : {}) } });
      return;
    }
    const e = err as { type?: string; status?: number; message?: string };
    if (e?.type === 'entity.parse.failed' || e?.type === 'entity.too.large') {
      res.status(e.status ?? 400).json({ error: { code: 'bad_body', message: 'The request body could not be read.' } });
      return;
    }
    log.error({ err, requestId: req.requestId }, 'unhandled error');
    res.status(500).json({ error: { code: 'internal', message: 'Something went wrong on our side. Try again.' } });
  };
}
