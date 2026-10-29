import { createHash, randomBytes } from 'node:crypto';

import type { CookieOptions, Request, Response } from 'express';

import { isProduction } from '../../config/env.js';

/**
 * The guest cart credential (docs/database-design.md §4, API_SPEC.md §5).
 *
 * A guest cart is owned by whoever holds a 256-bit random token. The token travels only in
 * an httpOnly cookie scoped to the cart routes, and the database stores its SHA-256 hash —
 * so a leaked database row cannot be replayed as a cookie, and page scripts never see the
 * token. A plain hash (not a slow KDF) is enough because the input is 32 random bytes, not a
 * human-chosen secret.
 */
export const GUEST_CART_COOKIE = 'commercecore.cart';

/** Matches the guest cart expiry the service writes (`GUEST_CART_TTL_MS`). */
export const GUEST_CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** base64url of 32 bytes is 43 characters. Anything else is not one of ours. */
const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

/**
 * Same attributes as the session cookie (src/lib/auth.ts, ADR 0006): `Lax` in development,
 * where frontend and API are same-site, and `None; Secure` in production, where they are not.
 * CSRF on the cart routes is covered by `requireTrustedOrigin`, like every other write.
 */
const COOKIE_OPTIONS: CookieOptions = {
  httpOnly: true,
  secure: isProduction,
  sameSite: isProduction ? 'none' : 'lax',
  path: '/api/v1/cart',
};

export function hashGuestToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The hash of the caller's guest token, or undefined when there is no well-formed one. */
export function readGuestTokenHash(req: Request): string | undefined {
  const value: unknown = (req.cookies as Record<string, unknown> | undefined)?.[GUEST_CART_COOKIE];

  if (typeof value !== 'string' || !TOKEN_PATTERN.test(value)) {
    return undefined;
  }

  return hashGuestToken(value);
}

/** Mints a token, sets it on the response, and returns its hash for the new cart row. */
export function issueGuestToken(res: Response): string {
  const token = randomBytes(32).toString('base64url');
  res.cookie(GUEST_CART_COOKIE, token, { ...COOKIE_OPTIONS, maxAge: GUEST_CART_TTL_MS });
  return hashGuestToken(token);
}

export function clearGuestToken(res: Response): void {
  res.clearCookie(GUEST_CART_COOKIE, COOKIE_OPTIONS);
}
