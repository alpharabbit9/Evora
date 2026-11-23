import { createHash, timingSafeEqual } from 'node:crypto';

import { Router, type RequestHandler } from 'express';

import { SAFE_METHODS } from '../../http/rate-limit.js';
import { notFound, unauthenticated } from '../../http/errors.js';
import { route } from '../../http/route.js';
import type { DrainSummary } from './drain.js';

/**
 * Scheduled outbox drain for serverless hosting (ADR 0028).
 *
 * Vercel Cron calls `GET /api/v1/internal/outbox/drain` with `Authorization: Bearer <CRON_SECRET>`.
 * Any other scheduler (GitHub Actions, cron-job.org) can call the same URL with the same header,
 * by GET or POST. Without a configured secret the endpoint does not exist, so a deployment that
 * runs the worker process instead exposes nothing new.
 */
function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export interface OutboxCronOptions {
  readonly secret: string | undefined;
  readonly drain: () => Promise<DrainSummary>;
}

export function createOutboxCronRouter(options: OutboxCronOptions): Router {
  const expected = options.secret ? digest(`Bearer ${options.secret}`) : undefined;
  const router = Router();

  const drain = route({
    handler: async ({ req }) => {
      if (expected === undefined) throw notFound();

      const presented = req.headers.authorization;
      if (typeof presented !== 'string' || !timingSafeEqual(digest(presented), expected)) {
        throw unauthenticated('A valid scheduler secret is required.');
      }

      return options.drain();
    },
  });

  router.get('/outbox/drain', drain);
  router.post('/outbox/drain', drain);
  return router;
}

/**
 * Drains the outbox once a successful write has been answered, and keeps the function invocation
 * alive until that drain ends (`waitUntil`). The promise is registered when the request arrives,
 * while the host's request context is certainly current, and settles after the response.
 *
 * Only a write that succeeded can have committed an outbox row, so reads and refusals (a rate
 * limit, a forbidden origin) never cause a database round trip here.
 */
export function drainAfterWrites(options: {
  readonly drain: () => Promise<void>;
  readonly waitUntil: (promise: Promise<unknown>) => void;
}): RequestHandler {
  return (req, res, next) => {
    if (SAFE_METHODS.has(req.method)) {
      next();
      return;
    }

    options.waitUntil(
      new Promise<void>((resolve) => {
        let settled = false;
        const settle = () => {
          if (settled) return;
          settled = true;
          resolve();
        };

        res.once('finish', () => {
          if (res.statusCode >= 400) {
            settle();
            return;
          }
          void options.drain().finally(settle);
        });
        // A request the client abandoned never finishes; do not hold the invocation for it.
        res.once('close', () => {
          if (!res.writableFinished) settle();
        });
      }),
    );

    next();
  };
}
