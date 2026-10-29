import compression from 'compression';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import express, { type Express } from 'express';
import helmet from 'helmet';
import { toNodeHandler } from 'better-auth/node';

import { env } from './config/env.js';
import { auth } from './lib/auth.js';
import { filesystemMediaHandler } from './lib/media.js';
import { errorHandler, notFoundHandler } from './http/error-handler.js';
import { requireTrustedOrigin } from './http/origin.js';
import {
  CREDENTIAL_AUTH_PATHS,
  DEFAULT_RATE_LIMITS,
  type RateLimitConfig,
  createRateLimiters,
} from './http/rate-limit.js';
import { REQUEST_ID_HEADER, requestContext } from './http/request-context.js';
import { apiRouter } from './http/routes/index.js';
import { healthRouter } from './http/routes/health.js';

export const API_PREFIX = '/api/v1';

export interface CreateAppOptions {
  /**
   * Test seam. Production calls `createApp()` with no arguments and gets
   * `DEFAULT_RATE_LIMITS`; the integration suite raises the credential allowance so that
   * creating fixture accounts does not trip the limiter it is not testing. One test uses
   * the defaults on purpose, to prove the limiter actually refuses.
   */
  readonly rateLimits?: RateLimitConfig;
}

export function createApp(options: CreateAppOptions = {}): Express {
  const app = express();
  const limiters = createRateLimiters(options.rateLimits ?? DEFAULT_RATE_LIMITS);

  // Behind a proxy/CDN the client IP comes from X-Forwarded-For; rate limiting and
  // audit logs are wrong without this. Narrow the hop count per deployment.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  app.use(requestContext);

  app.use(helmet());
  app.use(
    cors({
      // A single allow-listed origin, never a wildcard: the API answers credentialed
      // requests, and `Access-Control-Allow-Origin: *` is invalid with credentials.
      origin: env.FRONTEND_ORIGIN,
      credentials: true,
      exposedHeaders: [REQUEST_ID_HEADER],
    }),
  );
  app.use(compression());

  // Product images in development. With the s3 driver the bucket/CDN serves them instead.
  if (env.STORAGE_DRIVER === 'filesystem') {
    app.use('/media', filesystemMediaHandler());
  }

  app.use(API_PREFIX, healthRouter);

  // --- Better Auth subtree -------------------------------------------------------------
  /**
   * Better Auth runs its own origin check, but only when the request carries a `Cookie`
   * header (`validateOrigin` in its origin-check middleware returns early otherwise). That
   * covers the case that matters most — a hostile page driving `change-password` or
   * `delete-user` with the victim's ambient session — and
   * `tests/integration/security.test.ts` asserts it does. It leaves the cookie-less case
   * open, which means a cross-site `sign-in/email` is accepted: login CSRF, where an
   * attacker lands a victim's browser in a session of the attacker's choosing.
   *
   * So the same middleware the application routes use is applied here as well. This is not
   * a duplicate of a protection Better Auth already provides; it closes a case it
   * deliberately skips. Safe methods pass through, so the GET callbacks in email links and
   * any future OAuth redirect are unaffected.
   */
  app.use(`${API_PREFIX}/auth`, requireTrustedOrigin);

  // Rate limiting is applied in two layers: a small allowance on the endpoints that take
  // credentials or drive account recovery, and a generous one over the rest of the subtree
  // so that reading the session on navigation is not throttled. Credential endpoints count
  // against both, the stricter one deciding.
  app.use(
    CREDENTIAL_AUTH_PATHS.map((path) => `${API_PREFIX}/auth${path}`),
    limiters.credential,
  );
  app.use(`${API_PREFIX}/auth`, limiters.session);

  /**
   * `/list-sessions` is not served. Better Auth returns whole session rows there, and a
   * session row contains `token` — the value the session cookie carries. Handing that to
   * the browser would put a bearer-equivalent credential within reach of any script on the
   * page, which is the point of `httpOnly`. `GET /api/v1/me/sessions` returns the same
   * listing with the tokens removed.
   */
  app.all(`${API_PREFIX}/auth/list-sessions`, notFoundHandler);

  // Better Auth consumes the raw request itself, so it must be mounted before
  // express.json(). Express 5 requires a named wildcard (`*splat`).
  app.all(`${API_PREFIX}/auth/*splat`, toNodeHandler(auth));

  // --- Application routes --------------------------------------------------------------
  // Every route below this line gets parsed bodies and cookies.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // `requireTrustedOrigin` is the CSRF protection for these routes: they are authenticated
  // by the same cookie as the auth subtree, but Better Auth's own origin check does not
  // reach them. `limiters.write` skips safe methods itself.
  app.use(API_PREFIX, requireTrustedOrigin, limiters.write, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
