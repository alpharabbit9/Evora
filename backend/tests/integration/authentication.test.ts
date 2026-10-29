import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import {
  API,
  ORIGIN,
  AUTH,
  TEST_PASSWORD,
  createTestApp,
  signIn,
  signUp,
  truncateAll,
  uniqueEmail,
} from './harness.js';

/**
 * Authentication, end to end: the real Express app, the real Better Auth handler, a real
 * PostgreSQL. Sessions come from `Set-Cookie`, never from a stub.
 */
const app = createTestApp();

beforeAll(truncateAll);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('registration', () => {
  it('creates an account, hashes the password and signs the caller in', async () => {
    const email = uniqueEmail();

    const res = await request(app)
      .post(`${AUTH}/sign-up/email`)
      .send({ email, password: TEST_PASSWORD, name: 'New Shopper' });

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe(email.toLowerCase());
    // Server-owned defaults, not anything the request asked for.
    expect(res.body.user.role).toBe('CUSTOMER');
    expect(res.body.user.status).toBe('ACTIVE');

    const cookies = res.headers['set-cookie'] as unknown as string[];
    expect(cookies.join(';')).toContain('better-auth.session_token');

    // Better Auth owns credential storage: the password is on Account, hashed, and the
    // plaintext appears nowhere.
    const account = await prisma.account.findFirstOrThrow({
      where: { user: { email: email.toLowerCase() } },
      select: { password: true, providerId: true },
    });
    expect(account.providerId).toBe('credential');
    expect(account.password).toBeTypeOf('string');
    expect(account.password).not.toContain(TEST_PASSWORD);
    expect((account.password ?? '').length).toBeGreaterThan(40);
  });

  it('rejects a password below the configured minimum length', async () => {
    const res = await request(app)
      .post(`${AUTH}/sign-up/email`)
      .send({ email: uniqueEmail(), password: 'short', name: 'Too Short' });

    expect(res.status).toBe(400);
    expect(await prisma.user.count({ where: { name: 'Too Short' } })).toBe(0);
  });

  it('rejects a malformed email', async () => {
    const res = await request(app)
      .post(`${AUTH}/sign-up/email`)
      .send({ email: 'not-an-email', password: TEST_PASSWORD, name: 'Bad Email' });

    expect(res.status).toBe(400);
  });

  it('cannot self-assign a role or status at registration', async () => {
    const email = uniqueEmail('escalate');

    const res = await request(app).post(`${AUTH}/sign-up/email`).send({
      email,
      password: TEST_PASSWORD,
      name: 'Would Be Admin',
      role: 'ADMIN',
      status: 'ACTIVE',
    });

    expect(res.status).toBe(200);

    // `input: false` kept both out of the payload: the stored row has the defaults.
    const user = await prisma.user.findUniqueOrThrow({
      where: { email: email.toLowerCase() },
      select: { role: true, status: true },
    });
    expect(user.role).toBe('CUSTOMER');
    expect(user.status).toBe('ACTIVE');
  });
});

describe('sign-in', () => {
  it('refuses a wrong password without revealing whether the account exists', async () => {
    const session = await signUp(app);

    const wrongPassword = await signIn(app, session.email, 'definitely-not-the-password');
    const noSuchAccount = await signIn(app, uniqueEmail('ghost'), TEST_PASSWORD);

    expect(wrongPassword.status).toBe(401);
    expect(noSuchAccount.status).toBe(401);
    // Same code and message for both, so the response cannot be used to enumerate accounts.
    expect(wrongPassword.body).toEqual(noSuchAccount.body);
    expect(wrongPassword.cookie).toBe('');
  });

  it('does not leak internal details in an authentication failure', async () => {
    const res = await request(app)
      .post(`${AUTH}/sign-in/email`)
      .send({ email: uniqueEmail(), password: TEST_PASSWORD });

    const body = JSON.stringify(res.body);
    expect(body).not.toMatch(/node_modules|prisma|postgres|at Object|\.ts:|stack/i);
    // The generic message says the word "password"; what must never come back is the value
    // that was submitted.
    expect(body).not.toContain(TEST_PASSWORD);
  });
});

describe('session validation on protected routes', () => {
  it('refuses an unauthenticated request with 401 and the documented envelope', async () => {
    const res = await request(app).get(`${API}/me`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
    expect(res.body.error.requestId).toBeTypeOf('string');
  });

  it('serves the profile for a valid session', async () => {
    const session = await signUp(app);

    const res = await request(app).get(`${API}/me`).set('cookie', session.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(session.userId);
    expect(res.body.data.email).toBe(session.email);
  });

  it('refuses a forged session cookie', async () => {
    const res = await request(app)
      .get(`${API}/me`)
      .set('cookie', 'better-auth.session_token=forged-token-value.forged-signature')
      .set('origin', ORIGIN);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a session whose row has expired', async () => {
    const session = await signUp(app);

    // Expire it in the database rather than waiting a week. This is what makes the check
    // real: the guard reads the session row on every request, so the cookie alone is not
    // enough once the row is past its expiry.
    await prisma.session.updateMany({
      where: { userId: session.userId },
      data: { expiresAt: new Date(Date.now() - 60_000) },
    });

    const res = await request(app).get(`${API}/me`).set('cookie', session.cookie);

    expect(res.status).toBe(401);
  });

  it('refuses a session whose row has been deleted', async () => {
    const session = await signUp(app);
    await prisma.session.deleteMany({ where: { userId: session.userId } });

    const res = await request(app).get(`${API}/me`).set('cookie', session.cookie);

    expect(res.status).toBe(401);
  });

  it('refuses a session belonging to a suspended account', async () => {
    const session = await signUp(app);
    await prisma.user.update({ where: { id: session.userId }, data: { status: 'SUSPENDED' } });

    const res = await request(app).get(`${API}/me`).set('cookie', session.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.message).toContain('suspended');
  });
});

describe('sign-out', () => {
  it('invalidates the session it was called with', async () => {
    const session = await signUp(app);

    const before = await request(app).get(`${API}/me`).set('cookie', session.cookie);
    expect(before.status).toBe(200);

    const out = await request(app)
      .post(`${AUTH}/sign-out`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN);
    expect(out.status).toBe(200);

    const after = await request(app).get(`${API}/me`).set('cookie', session.cookie);
    expect(after.status).toBe(401);

    // Not merely a cleared cookie: the row is gone, so replaying the value cannot work.
    expect(await prisma.session.count({ where: { userId: session.userId } })).toBe(0);
  });
});

describe('own sessions', () => {
  it('lists active sessions without exposing their tokens', async () => {
    const session = await signUp(app);
    const second = await signIn(app, session.email);
    expect(second.status).toBe(200);

    const res = await request(app).get(`${API}/me/sessions`).set('cookie', session.cookie);

    expect(res.status).toBe(200);

    const sessions = res.body.data as { id: string; current: boolean }[];
    expect(sessions).toHaveLength(2);
    expect(sessions.filter((row) => row.current)).toHaveLength(1);

    // The session token is a bearer-equivalent credential; it must not reach the client.
    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('token');
    const storedTokens = await prisma.session.findMany({
      where: { userId: session.userId },
      select: { token: true },
    });
    for (const { token } of storedTokens) {
      expect(payload).not.toContain(token);
    }
  });

  it('does not serve Better Auth list-sessions, which would include tokens', async () => {
    const session = await signUp(app);

    const res = await request(app).get(`${AUTH}/list-sessions`).set('cookie', session.cookie);

    expect(res.status).toBe(404);
  });

  it('revokes one of the caller own sessions', async () => {
    const session = await signUp(app);
    const other = await signIn(app, session.email);

    const list = await request(app).get(`${API}/me/sessions`).set('cookie', session.cookie);
    const target = (list.body.data as { id: string; current: boolean }[]).find(
      (row) => !row.current,
    );
    expect(target).toBeDefined();

    const res = await request(app)
      .delete(`${API}/me/sessions/${target?.id ?? ''}`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN);

    expect(res.status).toBe(204);

    // The revoked session is dead, the caller's own still works.
    expect((await request(app).get(`${API}/me`).set('cookie', other.cookie)).status).toBe(401);
    expect((await request(app).get(`${API}/me`).set('cookie', session.cookie)).status).toBe(200);
  });

  it('cannot revoke another account session', async () => {
    const victim = await signUp(app);
    const attacker = await signUp(app);

    const victimSession = await prisma.session.findFirstOrThrow({
      where: { userId: victim.userId },
      select: { id: true },
    });

    const res = await request(app)
      .delete(`${API}/me/sessions/${victimSession.id}`)
      .set('cookie', attacker.cookie)
      .set('origin', ORIGIN);

    // 404, not 403: the response does not confirm that the id exists.
    expect(res.status).toBe(404);
    expect((await request(app).get(`${API}/me`).set('cookie', victim.cookie)).status).toBe(200);
  });
});

describe('password change', () => {
  it('requires the current password, and revokes other sessions on success', async () => {
    const session = await signUp(app);
    const other = await signIn(app, session.email);
    const newPassword = 'An-Even-Better-Password-1';

    const wrong = await request(app)
      .post(`${AUTH}/change-password`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ currentPassword: 'not-the-current-one', newPassword });
    expect(wrong.status).toBe(400);

    const changed = await request(app)
      .post(`${AUTH}/change-password`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ currentPassword: TEST_PASSWORD, newPassword, revokeOtherSessions: true });
    expect(changed.status).toBe(200);

    // The old password no longer works, the new one does.
    expect((await signIn(app, session.email, TEST_PASSWORD)).status).toBe(401);
    expect((await signIn(app, session.email, newPassword)).status).toBe(200);

    // A password change is a security event: the other session did not survive it.
    expect((await request(app).get(`${API}/me`).set('cookie', other.cookie)).status).toBe(401);
  });
});

describe('password reset', () => {
  it('answers identically for a known and an unknown email', async () => {
    const session = await signUp(app);

    const known = await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: session.email, redirectTo: 'http://localhost:3000/reset-password' });

    const unknown = await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: uniqueEmail('ghost'), redirectTo: 'http://localhost:3000/reset-password' });

    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    // No account enumeration through the reset endpoint (API_SPEC.md §3).
    expect(known.body).toEqual(unknown.body);
  });

  it('queues the reset link in the durable outbox, and only for a real account', async () => {
    const session = await signUp(app);
    await prisma.outboxEvent.deleteMany({});

    await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: session.email, redirectTo: 'http://localhost:3000/reset-password' });
    await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: uniqueEmail('ghost'), redirectTo: 'http://localhost:3000/reset-password' });

    const queued = await prisma.outboxEvent.findMany({
      where: { eventType: 'PASSWORD_RESET' },
      select: { status: true, payload: true },
    });

    // One row for the real account, none for the unknown one.
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('PENDING');
    expect((queued[0]?.payload as { userId: string }).userId).toBe(session.userId);
  });

  it('completes the reset with the issued token and ends every existing session', async () => {
    const session = await signUp(app);
    await prisma.outboxEvent.deleteMany({});

    await request(app)
      .post(`${AUTH}/request-password-reset`)
      .send({ email: session.email, redirectTo: 'http://localhost:3000/reset-password' });

    // Read the token the way the email would carry it. There is no delivery yet (no email
    // provider, PRD §9), which is exactly why this reads the queued row instead.
    const queued = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'PASSWORD_RESET' },
      select: { payload: true },
    });
    const url = new URL((queued.payload as { url: string }).url);
    const token = url.pathname.split('/').pop() ?? '';
    expect(token.length).toBeGreaterThan(8);

    const newPassword = 'Reset-To-This-Password-7';
    const reset = await request(app).post(`${AUTH}/reset-password`).send({ newPassword, token });
    expect(reset.status).toBe(200);

    expect((await signIn(app, session.email, TEST_PASSWORD)).status).toBe(401);
    expect((await signIn(app, session.email, newPassword)).status).toBe(200);

    // `revokeSessionsOnPasswordReset` — the session that existed before the reset is dead.
    expect((await request(app).get(`${API}/me`).set('cookie', session.cookie)).status).toBe(401);
  });

  it('refuses an invalid reset token', async () => {
    const res = await request(app)
      .post(`${AUTH}/reset-password`)
      .send({ newPassword: 'Some-Other-Password-5', token: 'not-a-real-token' });

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(JSON.stringify(res.body)).not.toMatch(/node_modules|prisma|\.ts:/i);
  });
});

describe('email verification', () => {
  it('queues a verification link in the outbox when one is requested', async () => {
    const session = await signUp(app);
    await prisma.outboxEvent.deleteMany({});

    const res = await request(app)
      .post(`${AUTH}/send-verification-email`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ email: session.email, callbackURL: 'http://localhost:3000/account' });

    expect(res.status).toBe(200);

    const queued = await prisma.outboxEvent.findMany({
      where: { eventType: 'EMAIL_VERIFICATION' },
      select: { status: true, payload: true },
    });
    expect(queued).toHaveLength(1);
    expect(queued[0]?.status).toBe('PENDING');
    expect((queued[0]?.payload as { userId: string }).userId).toBe(session.userId);
  });

  it('marks the account verified when the issued token is presented', async () => {
    const session = await signUp(app);
    await prisma.outboxEvent.deleteMany({});

    await request(app)
      .post(`${AUTH}/send-verification-email`)
      .set('cookie', session.cookie)
      .set('origin', ORIGIN)
      .send({ email: session.email, callbackURL: 'http://localhost:3000/account' });

    const queued = await prisma.outboxEvent.findFirstOrThrow({
      where: { eventType: 'EMAIL_VERIFICATION' },
      select: { payload: true },
    });
    const token = new URL((queued.payload as { url: string }).url).searchParams.get('token') ?? '';
    expect(token.length).toBeGreaterThan(8);

    await request(app).get(`${AUTH}/verify-email`).query({ token }).redirects(0);

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: session.userId },
      select: { emailVerified: true },
    });
    expect(user.emailVerified).toBe(true);
  });
});
