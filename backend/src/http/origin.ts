import type { RequestHandler } from 'express';

import { env } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { forbidden } from './errors.js';
import { SAFE_METHODS } from './rate-limit.js';

/**
 * CSRF protection for this application's own cookie-authenticated routes.
 *
 * Better Auth checks the request origin against `trustedOrigins` for the endpoints it
 * serves, but that protection stops at `/api/v1/auth`. Everything else — `PATCH /me`,
 * the address routes, the admin routes — is authenticated by the same cookie and needs
 * the same check, and in production that cookie is `SameSite=None` (ADR 0006), so the
 * browser will attach it to a cross-site request. Without this middleware a hostile page
 * could drive a state change on behalf of a signed-in user.
 *
 * Why an Origin check rather than a synchroniser token: the session is a cookie, the
 * frontend is a separate origin, and browsers send `Origin` on every cross-origin request
 * and on every same-origin request that is not a simple navigation. A token would add a
 * second mechanism — and a second thing to get wrong — for the same guarantee.
 *
 * A request with no `Origin` header is allowed through. That is not a hole: a browser
 * cannot be made to issue a credentialed cross-site POST without one (an HTML form post
 * carries it too), so a missing header means a non-browser caller — curl, a server-side
 * render, the test suite — which CSRF does not apply to.
 */
function originOf(value: string): string | undefined {
  try {
    return new URL(value).origin;
  } catch {
    return undefined;
  }
}

const TRUSTED_ORIGINS: ReadonlySet<string> = new Set(
  [originOf(env.FRONTEND_ORIGIN), originOf(env.BETTER_AUTH_URL)].filter(
    (origin): origin is string => origin !== undefined,
  ),
);

export const requireTrustedOrigin: RequestHandler = (req, _res, next) => {
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }

  const origin = req.headers.origin;

  if (origin === undefined) {
    next();
    return;
  }

  // A sandboxed iframe or a redirected cross-origin request sends the literal "null";
  // it is not in the allow-list, so it is refused along with everything else unknown.
  if (!TRUSTED_ORIGINS.has(origin)) {
    logger.warn({ origin, path: req.path, method: req.method }, 'Rejected an untrusted origin');
    throw forbidden('This request did not come from a trusted origin.');
  }

  next();
};
