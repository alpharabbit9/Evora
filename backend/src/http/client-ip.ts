import { createHash, timingSafeEqual } from 'node:crypto';
import { isIP } from 'node:net';

import type { RequestHandler } from 'express';

/**
 * The visitor's address when the storefront forwards `/api/*` to this API (ADR 0028).
 *
 * On Vercel the storefront and the API are separate deployments, and the storefront proxies every
 * browser call so the session cookie stays on its own host (ADR 0024). The API then sees the
 * storefront's address on every request, which would put every visitor in one rate-limit bucket
 * and give all guests one shared assistant allowance. So the storefront passes the address it
 * was given by its own edge, with a secret only it and the API hold, and this middleware believes
 * that address only when the secret matches.
 *
 * Both headers are removed from the request either way, so nothing downstream can read or log
 * the secret, and a claimed address without the secret is simply ignored.
 */
export const PROXY_SECRET_HEADER = 'x-commercecore-proxy-secret';
export const PROXY_CLIENT_IP_HEADER = 'x-commercecore-client-ip';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

export function forwardedClientIp(secret: string | undefined): RequestHandler {
  // Compared as digests, so the comparison takes the same time whatever the presented length.
  const expected = secret ? digest(secret) : undefined;

  return (req, _res, next) => {
    const presented = req.headers[PROXY_SECRET_HEADER];
    const claimed = req.headers[PROXY_CLIENT_IP_HEADER];
    delete req.headers[PROXY_SECRET_HEADER];
    delete req.headers[PROXY_CLIENT_IP_HEADER];

    if (
      expected !== undefined &&
      typeof presented === 'string' &&
      timingSafeEqual(digest(presented), expected) &&
      typeof claimed === 'string' &&
      isIP(claimed.trim()) !== 0
    ) {
      // `req.ip` is a getter on Express's request prototype; an own property shadows it for this
      // request only. Rate limiting, audit entries and the assistant all read `req.ip`.
      Object.defineProperty(req, 'ip', {
        value: claimed.trim(),
        configurable: true,
        enumerable: true,
      });
    }

    next();
  };
}
