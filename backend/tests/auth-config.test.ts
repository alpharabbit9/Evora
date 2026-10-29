import type { BetterAuthOptions } from 'better-auth';
import { describe, expect, it } from 'vitest';

import { auth } from '../src/lib/auth.js';

/**
 * Configuration assertions for the security-relevant Better Auth options.
 *
 * These are here because each one is a setting whose wrong value fails silently: nothing
 * breaks, no test goes red, and a protection is simply absent. They run without a database
 * so they are part of `npm test`.
 */
/**
 * Widened to Better Auth's full option type on purpose. `auth.options` is narrowed to the
 * literal shape that was passed, so an option this config does NOT set is absent from the
 * type and asserting it is `undefined` would not even compile — which would quietly delete
 * the checks below that an option stays unset.
 */
const options: BetterAuthOptions = auth.options;

describe('session configuration', () => {
  it('does not enable the session cookie cache', () => {
    // A cookie cache serves the session without reading the database, so a revoked
    // session, a suspended account or a demoted role would keep working until it expires.
    // Immediate revocation is a requirement here, and several tests depend on it.
    expect(options.session?.cookieCache?.enabled).toBeUndefined();
  });

  it('expires sessions and refreshes them on a longer cycle', () => {
    expect(options.session?.expiresIn).toBe(60 * 60 * 24 * 7);
    expect(options.session?.updateAge).toBe(60 * 60 * 24);
    expect(options.session?.freshAge).toBeGreaterThan(0);
  });
});

describe('credential configuration', () => {
  it('requires a password long enough to be worth hashing', () => {
    expect(options.emailAndPassword?.minPasswordLength).toBeGreaterThanOrEqual(12);
  });

  it('does not override the password hashing or verification implementation', () => {
    // CLAUDE.md: never invent cryptography. Better Auth's own implementation stands.
    expect(options.emailAndPassword?.password?.hash).toBeUndefined();
    expect(options.emailAndPassword?.password?.verify).toBeUndefined();
  });

  it('revokes sessions when a password is reset', () => {
    expect(options.emailAndPassword?.revokeSessionsOnPasswordReset).toBe(true);
  });

  it('expires a reset token quickly', () => {
    expect(options.emailAndPassword?.resetPasswordTokenExpiresIn).toBeLessThanOrEqual(60 * 60);
  });

  it('wires reset and verification delivery to something real', () => {
    // Not a claim that email is delivered — it is not, see auth-email.ts. This asserts the
    // callbacks exist, so the endpoints are not silently inert.
    expect(options.emailAndPassword?.sendResetPassword).toBeTypeOf('function');
    expect(options.emailVerification?.sendVerificationEmail).toBeTypeOf('function');
  });

  it('does not require email verification while delivery is unimplemented', () => {
    // Turning this on before an email provider exists would lock every new account out.
    // The assertion is a reminder that the two changes belong together.
    expect(options.emailAndPassword?.requireEmailVerification).toBe(false);
  });
});

describe('cross-origin and CSRF configuration', () => {
  it('states the origin and CSRF checks explicitly rather than inheriting a default', () => {
    // Left unset, Better Auth 1.7 turns the origin check off under NODE_ENV=test, which
    // would make the protection untestable and environment-dependent.
    expect(options.advanced?.disableOriginCheck).toBe(false);
    expect(options.advanced?.disableCSRFCheck).toBe(false);
  });

  it('allow-lists exactly the frontend origin', () => {
    expect(options.trustedOrigins).toEqual([process.env.FRONTEND_ORIGIN]);
  });

  it('sets httpOnly session cookies', () => {
    expect(options.advanced?.defaultCookieAttributes?.httpOnly).toBe(true);
    expect(options.advanced?.defaultCookieAttributes?.path).toBe('/');
  });
});

describe('rate limiting', () => {
  it('leaves rate limiting to the Express layer, deliberately', () => {
    // One mechanism, one set of windows, one error envelope (src/http/rate-limit.ts).
    expect(options.rateLimit?.enabled).toBe(false);
  });
});

describe('privilege escalation guard', () => {
  const beforeUpdate = options.databaseHooks?.user?.update?.before;

  it('is installed', () => {
    expect(beforeUpdate).toBeTypeOf('function');
  });

  it('passes an ordinary profile update through untouched', async () => {
    const result = await beforeUpdate?.({ name: 'New Name' }, null);

    // No `data` returned means "write what was given".
    expect(result).toBeUndefined();
  });

  it('drops role and status while keeping the rest of the update', async () => {
    const result = await beforeUpdate?.(
      { id: 'user_1', name: 'New Name', role: 'ADMIN', status: 'SUSPENDED' },
      null,
    );

    expect(result).toEqual({ data: { id: 'user_1', name: 'New Name' } });
  });
});
