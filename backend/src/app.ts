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
import { paymentReturnRouter, paymentWebhookRouter } from './modules/payments/payments.routes.js';

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
  // A streamed reply (the assistant's server-sent events, ADR 0025) must reach the browser as it
  // is written; compression would hold it back until a buffer fills.
  app.use(
    compression({
      filter: (req, res) =>
        !String(res.getHeader('content-type') ?? '').startsWith('text/event-stream') &&
        compression.filter(req, res),
    }),
  );

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

  // --- Payment provider callbacks ------------------------------------------------------
  // Ahead of the Origin check, because these arrive from the provider or from a cross-site
  // redirect, and neither uses a cookie. The webhook proves itself with a signature and has no
  // rate limit (API_SPEC.md §10); the return proves nothing, is believed about nothing, and is
  // limited because each request can make us call the provider.
  app.use(`${API_PREFIX}/webhooks/payments`, paymentWebhookRouter);
  app.use(`${API_PREFIX}/payments/return`, limiters.paymentReturn, paymentReturnRouter);

  // --- Application routes --------------------------------------------------------------
  // Every route below this line gets parsed bodies and cookies.
  app.use(express.json({ limit: '100kb' }));
  app.use(cookieParser());

  // `requireTrustedOrigin` is the CSRF protection for these routes: they are authenticated
  // by the same cookie as the auth subtree, but Better Auth's own origin check does not
  // reach them. `limiters.write` skips safe methods itself. Checkout counts against its own,
  // smaller allowance as well, behind the same origin check.
  app.use(`${API_PREFIX}/checkout`, requireTrustedOrigin, limiters.checkout);
  // Starting a payment session calls the provider, so it shares checkout's allowance.
  app.use(`${API_PREFIX}/orders/:orderId/payment-session`, requireTrustedOrigin, limiters.checkout);
  app.use(`${API_PREFIX}/search/suggestions`, limiters.suggestions);
  app.use(`${API_PREFIX}/assistant`, requireTrustedOrigin, limiters.assistant);
  app.use(API_PREFIX, requireTrustedOrigin, limiters.write, apiRouter);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
