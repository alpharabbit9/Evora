import type { RequestHandler } from 'express';
import rateLimit from 'express-rate-limit';

import { logger } from '../lib/logger.js';
import { rateLimited } from './errors.js';

/**
 * The one rate-limiting mechanism in this API (API_SPEC.md §10, architecture.md §12).
 *
 * Better Auth ships its own limiter; it is switched off in `src/lib/auth.ts` so that
 * limits, windows and the error body are defined in a single place. Exceeding a limit
 * produces the documented `RATE_LIMITED` envelope with a request id, like every other
 * failure, instead of a second library's error shape.
 *
 * Known limitation: the store is in-process memory, so limits are per instance. A second
 * replica doubles the effective allowance. Moving to a shared store (Redis, or Better
 * Auth's `storage: 'database'`) is the fix when this is deployed to more than one
 * instance — see ADR 0009.
 */
export const SAFE_METHODS: ReadonlySet<string> = new Set(['GET', 'HEAD', 'OPTIONS']);

export interface RateLimitRule {
  readonly windowMs: number;
  readonly limit: number;
}

export interface RateLimitConfig {
  /**
   * Credential endpoints: sign-in, sign-up, password reset, verification resend. Brute
   * force and account-enumeration probing target these, so the window is long and the
   * allowance small.
   */
  readonly credential: RateLimitRule;
  /**
   * The rest of the auth subtree, `/get-session` above all. The frontend reads the session
   * on navigation, so this has to be generous or ordinary browsing would be throttled —
   * which is exactly what a single blanket limit over the whole subtree used to do.
   */
  readonly session: RateLimitRule;
  /** State-changing requests to the application's own routes. */
  readonly write: RateLimitRule;
  /**
   * Quotes and order placement (API_SPEC.md §10). Tighter than `write` because each request
   * re-prices a whole order, and a placement claims stock.
   */
  readonly checkout: RateLimitRule;
  /**
   * The unauthenticated browser return from the payment gateway. Each request can make the API
   * call the provider, so it must not become a way to make us send traffic. The provider's own
   * notifications are deliberately NOT limited (API_SPEC.md §10): dropping one would lose a
   * payment event, and an unsigned one is refused before any work happens.
   */
  readonly paymentReturn: RateLimitRule;
  /**
   * Search-as-you-type (API_SPEC.md §10). A GET, so `write` does not cover it, and each request
   * runs a full catalog search. Generous enough for typing, which the storefront debounces.
   */
  readonly suggestions: RateLimitRule;
  /**
   * Messages to the shopping assistant (ADR 0025). Each one calls a paid provider, so it is
   * tighter than `write`. The real cap is the daily allowance counted in the database; this
   * stops a burst from one address before it reaches that query.
   */
  readonly assistant: RateLimitRule;
}

export const DEFAULT_RATE_LIMITS: RateLimitConfig = {
  credential: { windowMs: 15 * 60 * 1000, limit: 20 },
  session: { windowMs: 60 * 1000, limit: 120 },
  write: { windowMs: 60 * 1000, limit: 60 },
  checkout: { windowMs: 60 * 1000, limit: 30 },
  paymentReturn: { windowMs: 60 * 1000, limit: 30 },
  suggestions: { windowMs: 60 * 1000, limit: 120 },
  assistant: { windowMs: 60 * 1000, limit: 12 },
};

/**
 * Auth subpaths that take credentials or drive an account-recovery flow. Listed explicitly
 * rather than pattern-matched: a new Better Auth endpoint should have to be classified by
 * hand instead of silently landing in the generous bucket.
 */
export const CREDENTIAL_AUTH_PATHS: readonly string[] = [
  '/sign-in/email',
  '/sign-up/email',
  // Better Auth 1.7 names this `/request-password-reset`. `/forget-password` is NOT an
  // alias in this version — it exists only as the email-otp plugin's prefix — so listing
  // the wrong one would have left password reset unlimited while looking covered.
  '/request-password-reset',
  '/reset-password',
  '/verify-password',
  '/change-password',
  '/change-email',
  '/send-verification-email',
  '/delete-user',
];

function buildLimiter(name: string, rule: RateLimitRule, options: { skipSafe?: boolean } = {}) {
  return rateLimit({
    windowMs: rule.windowMs,
    limit: rule.limit,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    ...(options.skipSafe === true ? { skip: (req) => SAFE_METHODS.has(req.method) } : {}),
    // Hand the refusal to the error middleware so it carries the request id and the same
    // envelope as every other error. The path is logged; the caller's body never is.
    handler: (req, _res, next) => {
      logger.warn({ limiter: name, path: req.path, method: req.method }, 'Rate limit reached');
      next(rateLimited());
    },
  });
}

export interface AuthLimiters {
  /** Mount on `CREDENTIAL_AUTH_PATHS` only. */
  readonly credential: RequestHandler;
  /** Mount on the whole auth subtree, after `credential`. */
  readonly session: RequestHandler;
  /** Mount on the application's own routes; skips GET/HEAD/OPTIONS itself. */
  readonly write: RequestHandler;
  /** Mount on `/checkout`, ahead of `write`. */
  readonly checkout: RequestHandler;
  /** Mount on the gateway's browser return. Counts every method: the gateway may use either. */
  readonly paymentReturn: RequestHandler;
  /** Mount on `/search/suggestions`. Counts GETs, unlike `write`. */
  readonly suggestions: RequestHandler;
  /** Mount on `/assistant`. Counts writes only: reading a conversation is not limited here. */
  readonly assistant: RequestHandler;
}

/**
 * Fresh limiters with their own stores. Built per `createApp()` call rather than at module
 * load so that two app instances in one process (the test suite makes several) do not share
 * a counter and interfere with each other.
 */
export function createRateLimiters(config: RateLimitConfig = DEFAULT_RATE_LIMITS): AuthLimiters {
  return {
    credential: buildLimiter('credential', config.credential),
    session: buildLimiter('auth-session', config.session),
    write: buildLimiter('write', config.write, { skipSafe: true }),
    checkout: buildLimiter('checkout', config.checkout, { skipSafe: true }),
    paymentReturn: buildLimiter('payment-return', config.paymentReturn),
    suggestions: buildLimiter('suggestions', config.suggestions),
    assistant: buildLimiter('assistant', config.assistant, { skipSafe: true }),
  };
}
