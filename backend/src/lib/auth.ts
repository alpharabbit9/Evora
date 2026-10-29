import { OutboxEventType } from '@prisma/client';
import { betterAuth } from 'better-auth';
import { prismaAdapter } from 'better-auth/adapters/prisma';

import { env, isProduction } from '../config/env.js';
import { enqueueAuthEmail } from '../modules/notifications/auth-email.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';

/**
 * Better Auth owns credential hashing, session issuance and cookie handling.
 * Do not hand-roll password or session cryptography (CLAUDE.md engineering rules).
 *
 * `role` / `status` are declared as additional user fields so authorization can be
 * enforced server-side (PRD §3). They are NOT client-writable: `input: false` keeps
 * them out of the registration/update payloads, so a caller cannot self-assign ADMIN.
 */

/** One hour. Short enough that a leaked reset link stops working quickly. */
const RESET_TOKEN_TTL_SECONDS = 60 * 60;

export const auth = betterAuth({
  database: prismaAdapter(prisma, { provider: 'postgresql' }),
  secret: env.BETTER_AUTH_SECRET,
  baseURL: env.BETTER_AUTH_URL,
  basePath: '/api/v1/auth',

  trustedOrigins: [env.FRONTEND_ORIGIN],

  emailAndPassword: {
    enabled: true,

    // Delivery is not implemented (no provider selected, PRD §9), so requiring verification
    // would lock every new account out permanently. Flip this to `true` in the same change
    // that lands the M9 outbox worker and a provider — not before.
    requireEmailVerification: false,

    minPasswordLength: 12,
    maxPasswordLength: 128,

    resetPasswordTokenExpiresIn: RESET_TOKEN_TTL_SECONDS,

    // A password reset is a security event: every other session for that account dies with
    // it, so a stolen session cannot outlive the recovery that was meant to end it.
    revokeSessionsOnPasswordReset: true,

    sendResetPassword: async ({ user, url, token }) => {
      await enqueueAuthEmail({
        type: OutboxEventType.PASSWORD_RESET,
        recipient: { id: user.id, email: user.email, name: user.name },
        url,
        token,
      });
    },

    onPasswordReset: ({ user }) => {
      // Identifier only — never the token or the new password.
      logger.info({ userId: user.id }, 'Password reset completed; other sessions revoked');
      return Promise.resolve();
    },
  },

  emailVerification: {
    // Nothing can be delivered yet, so sign-up does not pretend to send anything. The
    // `/auth/send-verification-email` endpoint stays available for when delivery exists.
    sendOnSignUp: false,
    autoSignInAfterVerification: true,
    expiresIn: 60 * 60 * 24,

    sendVerificationEmail: async ({ user, url, token }) => {
      await enqueueAuthEmail({
        type: OutboxEventType.EMAIL_VERIFICATION,
        recipient: { id: user.id, email: user.email, name: user.name },
        url,
        token,
      });
    },
  },

  user: {
    additionalFields: {
      role: {
        type: 'string',
        required: false,
        defaultValue: 'CUSTOMER',
        input: false,
      },
      status: {
        type: 'string',
        required: false,
        defaultValue: 'ACTIVE',
        input: false,
      },
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7,
    updateAge: 60 * 60 * 24,

    /**
     * How recently the caller must have authenticated for Better Auth to allow a sensitive
     * account change (it enforces this on `deleteUser`).
     */
    freshAge: 60 * 60 * 24,

    /**
     * `cookieCache` is deliberately NOT enabled. It serves the session from a signed cookie
     * without reading the database, which would mean a revoked session, a suspended account
     * or a demoted role keeps working until the cache expires. Revocation has to be
     * immediate here (PRD §4 FR-05, task security requirements), so every request pays for
     * the session lookup.
     */
  },

  /**
   * Better Auth's own limiter is off because the Express layer owns rate limiting for the
   * whole API (`src/http/rate-limit.ts`). Two limiters would mean two windows, two memory
   * stores and two different error bodies for the same event. See ADR 0009 for the
   * trade-off: the Express store is per-instance, so horizontal scaling needs a shared one.
   */
  rateLimit: { enabled: false },

  advanced: {
    useSecureCookies: isProduction,
    defaultCookieAttributes: {
      httpOnly: true,
      // Cross-SITE in production (different registrable domains), so the cookie has to be
      // `None; Secure`. In development frontend and API differ only by port, which is
      // same-site, so `Lax` is both sufficient and safer. ADR 0006 records why this is
      // cross-origin at all, and that putting both behind one origin is preferable.
      sameSite: isProduction ? 'none' : 'lax',
      secure: isProduction,
      path: '/',
    },

    /**
     * Both of these are stated explicitly, and the value is the same in every environment
     * on purpose.
     *
     * Left unset, Better Auth 1.7 derives `skipOriginCheck` as
     * `disableOriginCheck !== undefined ? disableOriginCheck : isTest() ? true : false`
     * (`dist/context/create-context.mjs`) — so under `NODE_ENV=test` the origin check, and
     * with it the CSRF check that keys off `disableCSRFCheck` being undefined, turns
     * itself off. The protection would then be live in production and absent in the test
     * suite, which is the worst of both: no test could ever show that it works, and a
     * regression in it would stay green.
     *
     * With `SameSite=None` in production (ADR 0006), this check is what stands between a
     * hostile page and this API. It is not something to leave to an implicit default.
     */
    disableOriginCheck: false,
    disableCSRFCheck: false,
  },

  databaseHooks: {
    user: {
      update: {
        /**
         * Defence in depth against privilege escalation, at the last point before the
         * write.
         *
         * `input: false` already makes `/auth/update-user` refuse a payload containing
         * `role` or `status` outright — verified in
         * `tests/integration/authorization.test.ts`, which asserts a 400 — so in this
         * version nothing reaches here. The hook exists for the version that does: a
         * Better Auth upgrade or a plugin that routes a user update through the adapter
         * would otherwise be one permissive body schema away from writing a role. The
         * fields are dropped and the rest of the update proceeds, so a legitimate change
         * is never silently lost.
         *
         * Role and status are changed only by the admin endpoints, which write through
         * Prisma and so do not pass through this hook.
         */
        before: (user) => {
          if (!('role' in user) && !('status' in user)) {
            return Promise.resolve();
          }

          const { role: _role, status: _status, ...safe } = user;
          logger.warn(
            { userId: user.id },
            'Stripped a role/status change attempted through the auth API',
          );

          return Promise.resolve({ data: safe });
        },
      },
    },
  },
});

export type AuthSession = Awaited<ReturnType<typeof auth.api.getSession>>;
