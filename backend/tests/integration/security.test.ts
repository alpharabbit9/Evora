import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { env } from '../../src/config/env.js';
import { prisma } from '../../src/lib/prisma.js';
import {
  API,
  ORIGIN,
  AUTH,
  TEST_PASSWORD,
  addressPayload,
  createTestApp,
  signUp,
  signUpAs,
  truncateAll,
  uniqueEmail,
} from './harness.js';

/**
 * Cross-origin behaviour, CSRF protection, cookie attributes, rate limiting and safe error
 * responses (task section 8, architecture.md §12, ADR 0006).
 */
const app = createTestApp();
const HOSTILE_ORIGIN = 'https://evil.example';

beforeAll(truncateAll);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('CORS', () => {
  it('allows the configured frontend origin with credentials', async () => {
    const res = await request(app).get(`${API}/livez`).set('origin', env.FRONTEND_ORIGIN);

    expect(res.headers['access-control-allow-origin']).toBe(env.FRONTEND_ORIGIN);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });

  it('never answers with a wildcard origin, which is invalid with credentials', async () => {
    const res = await request(app).get(`${API}/livez`).set('origin', HOSTILE_ORIGIN);

    expect(res.headers['access-control-allow-origin']).not.toBe('*');
    // The allow-list echoes only the configured origin, so the browser blocks the read.
    expect(res.headers['access-control-allow-origin']).toBe(env.FRONTEND_ORIGIN);
  });

  it('answers a preflight for the frontend origin', async () => {
    const res = await request(app)
      .options(`${API}/me`)
      .set('origin', env.FRONTEND_ORIGIN)
      .set('access-control-request-method', 'PATCH');

    expect(res.status).toBeLessThan(300);
    expect(res.headers['access-control-allow-credentials']).toBe('true');
  });
});

describe('CSRF protection on the application routes', () => {
  it('refuses a state-changing request from an untrusted origin', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('origin', HOSTILE_ORIGIN)
      .send({ name: 'Changed By Another Site' });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      select: { name: true },
    });
    expect(user.name).toBe('Test Shopper');
  });

  it('allows the same request from the configured frontend origin', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('origin', env.FRONTEND_ORIGIN)
      .send({ name: 'Changed By The App' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Changed By The App');
  });

  it('covers every unsafe method on the protected subtrees', async () => {
    const customer = await signUp(app);
    const admin = await signUpAs(app, UserRole.ADMIN);

    const created = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('origin', env.FRONTEND_ORIGIN)
      .send(addressPayload());
    const addressId = created.body.data.id as string;

    const hostile = [
      request(app)
        .post(`${API}/me/addresses`)
        .set('cookie', customer.cookie)
        .set('origin', ORIGIN)
        .set('origin', HOSTILE_ORIGIN)
        .send(addressPayload()),
      request(app)
        .patch(`${API}/me/addresses/${addressId}`)
        .set('cookie', customer.cookie)
        .set('origin', ORIGIN)
        .set('origin', HOSTILE_ORIGIN)
        .send({ city: 'Elsewhere' }),
      request(app)
        .delete(`${API}/me/addresses/${addressId}`)
        .set('cookie', customer.cookie)
        .set('origin', ORIGIN)
        .set('origin', HOSTILE_ORIGIN),
      request(app)
        .patch(`${API}/admin/customers/${customer.userId}/status`)
        .set('cookie', admin.cookie)
        .set('origin', ORIGIN)
        .set('origin', HOSTILE_ORIGIN)
        .send({ status: 'SUSPENDED' }),
    ];

    for (const res of await Promise.all(hostile)) {
      expect(res.status).toBe(403);
    }

    // Nothing happened.
    const address = await prisma.address.findUniqueOrThrow({ where: { id: addressId } });
    expect(address.city).toBe('Testville');
    expect(await prisma.address.count({ where: { userId: customer.userId } })).toBe(1);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: customer.userId },
          select: { status: true },
        })
      ).status,
    ).toBe('ACTIVE');
  });

  it('does not block reads, which CORS already protects', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .get(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('origin', HOSTILE_ORIGIN);

    // The request is served, but the browser cannot read the response: the
    // Access-Control-Allow-Origin header names only the configured frontend.
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).not.toBe(HOSTILE_ORIGIN);
  });

  it('refuses a cookie-bearing auth request from an untrusted origin', async () => {
    const customer = await signUp(app);

    // The case CSRF is actually about: a hostile page using the victim's ambient session to
    // change their password. Better Auth's own origin check covers this, because the
    // request carries a cookie.
    const res = await request(app)
      .post(`${AUTH}/change-password`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('origin', HOSTILE_ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword: 'Attacker-Chosen-Pass-1' });

    expect(res.status).toBe(403);
    // The old password still works, so nothing was changed.
    const stillWorks = await request(app)
      .post(`${AUTH}/sign-in/email`)
      .set('origin', env.FRONTEND_ORIGIN)
      .send({ email: customer.email, password: TEST_PASSWORD });
    expect(stillWorks.status).toBe(200);
  });

  it('refuses a cookie-less sign-in from an untrusted origin, which Better Auth alone allows', async () => {
    const customer = await signUp(app);

    // Better Auth's `validateOrigin` returns early when the request has no `Cookie`
    // header, so on its own this request would be accepted — login CSRF, where a victim's
    // browser is landed in a session chosen by the attacker. The application's own
    // `requireTrustedOrigin` is mounted on this subtree to close that case.
    const res = await request(app)
      .post(`${AUTH}/sign-in/email`)
      .set('origin', HOSTILE_ORIGIN)
      .send({ email: customer.email, password: TEST_PASSWORD });

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');

    const fromTheApp = await request(app)
      .post(`${AUTH}/sign-in/email`)
      .set('origin', env.FRONTEND_ORIGIN)
      .send({ email: customer.email, password: TEST_PASSWORD });
    expect(fromTheApp.status).toBe(200);
  });

  it('refuses a cross-site registration', async () => {
    const res = await request(app)
      .post(`${AUTH}/sign-up/email`)
      .set('origin', HOSTILE_ORIGIN)
      .send({ email: uniqueEmail('crosssite'), password: TEST_PASSWORD, name: 'Cross Site' });

    expect(res.status).toBe(403);
  });

  it('refuses a redirectTo pointing outside the trusted origins', async () => {
    const customer = await signUp(app);

    // The reset link is built from `redirectTo`; an untrusted value would mail the victim a
    // link that hands the token to the attacker's site.
    const res = await request(app)
      .post(`${AUTH}/request-password-reset`)
      .set('origin', env.FRONTEND_ORIGIN)
      .send({ email: customer.email, redirectTo: `${HOSTILE_ORIGIN}/steal` });

    expect(res.status).toBe(403);
    expect(await prisma.outboxEvent.count({ where: { eventType: 'PASSWORD_RESET' } })).toBe(0);
  });
});

describe('session cookie attributes', () => {
  it('is HttpOnly, path-scoped and SameSite-constrained', async () => {
    const res = await request(app)
      .post(`${AUTH}/sign-up/email`)
      .set('origin', env.FRONTEND_ORIGIN)
      .send({ email: uniqueEmail(), password: TEST_PASSWORD, name: 'Cookie Check' });

    const cookie = (res.headers['set-cookie'] as unknown as string[]).find((entry) =>
      entry.startsWith('better-auth.session_token='),
    );

    expect(cookie).toBeDefined();
    // HttpOnly is what keeps the session out of reach of page scripts.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('Path=/');
    expect(cookie).toContain('Max-Age=');
    // Development is same-site (frontend and API differ only by port), so Lax applies and
    // `Secure` is absent because there is no TLS locally. Production flips both — see the
    // `isProduction` branch in src/lib/auth.ts and ADR 0006.
    expect(cookie).toContain('SameSite=Lax');
  });
});

describe('rate limiting', () => {
  it('refuses repeated sign-in attempts with the documented envelope', async () => {
    // Its own app, so the tight limit does not affect the rest of the suite. Two attempts
    // allowed, the third refused.
    const limited = createTestApp({ credential: { windowMs: 60_000, limit: 2 } });
    const email = uniqueEmail('bruteforce');

    const statuses: number[] = [];
    let body: unknown;

    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(limited)
        .post(`${AUTH}/sign-in/email`)
        .send({ email, password: 'guess-number-' + String(attempt) });
      statuses.push(res.status);
      body = res.body;
    }

    expect(statuses.slice(0, 2)).toEqual([401, 401]);
    expect(statuses[2]).toBe(429);
    expect(body).toMatchObject({ error: { code: 'RATE_LIMITED' } });
    expect((body as { error: { requestId: string } }).error.requestId).toBeTypeOf('string');
  });

  it('does not throttle session reads at the credential rate', async () => {
    const session = await signUp(app);
    const limited = createTestApp({ credential: { windowMs: 60_000, limit: 2 } });

    // The frontend reads the session on navigation; it must not share the small credential
    // allowance. A single blanket limiter over the whole auth subtree used to do exactly
    // that.
    for (let i = 0; i < 6; i += 1) {
      const res = await request(limited).get(`${AUTH}/get-session`).set('cookie', session.cookie);
      expect(res.status).toBe(200);
    }
  });

  it('limits state-changing requests to the application routes', async () => {
    const customer = await signUp(app);
    const limited = createTestApp({ write: { windowMs: 60_000, limit: 2 } });

    const statuses: number[] = [];
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const res = await request(limited)
        .patch(`${API}/me`)
        .set('cookie', customer.cookie)
        .set('origin', ORIGIN)
        .send({ name: `Rename ${String(attempt)}` });
      statuses.push(res.status);
    }

    expect(statuses).toEqual([200, 200, 429]);

    // Reads are not consumed by the write bucket.
    const read = await request(limited).get(`${API}/me`).set('cookie', customer.cookie);
    expect(read.status).toBe(200);
  });
});

describe('safe error responses', () => {
  it('answers an unknown route with the documented envelope and no internals', async () => {
    const res = await request(app).get(`${API}/does-not-exist`);

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at Object|\.ts:/);
  });

  it('answers a malformed JSON body without a stack trace', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .set('content-type', 'application/json')
      .send('{"name": broken');

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|at JSON\.parse|\.ts:/);
  });

  it('reports a validation failure per field, without echoing the value', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ name: '' });

    expect(res.status).toBe(400);
    expect(res.body.error.details).toEqual([{ field: 'name', issue: expect.any(String) }]);
  });

  it('carries a request id on every response for correlation', async () => {
    const ok = await request(app).get(`${API}/livez`);
    const failed = await request(app).get(`${API}/me`);

    expect(ok.headers['x-request-id']).toBeTypeOf('string');
    expect(ok.body.meta.requestId).toBe(ok.headers['x-request-id']);
    expect(failed.body.error.requestId).toBe(failed.headers['x-request-id']);
  });
});

describe('existing functionality is unaffected', () => {
  it('still serves liveness and readiness', async () => {
    const livez = await request(app).get(`${API}/livez`);
    const readyz = await request(app).get(`${API}/readyz`);

    expect(livez.status).toBe(200);
    expect(livez.body.data).toEqual({ status: 'ok' });
    expect(readyz.status).toBe(200);
    expect(readyz.body.data).toEqual({ status: 'ready', database: 'reachable' });
  });
});
