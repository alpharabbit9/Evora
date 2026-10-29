import { createHash, randomUUID } from 'node:crypto';

import type { UserStatus } from '@prisma/client';
import { UserRole } from '@prisma/client';
import type { Express } from 'express';
import request from 'supertest';

import { API_PREFIX, createApp } from '../../src/app.js';
import { env } from '../../src/config/env.js';
import type { RateLimitConfig } from '../../src/http/rate-limit.js';
import { prisma } from '../../src/lib/prisma.js';

/**
 * Shared plumbing for the integration suite.
 *
 * These tests drive the real Express app with the real Better Auth handler against a real
 * PostgreSQL. Nothing about the session is mocked: an account is created through
 * `POST /auth/sign-up/email`, the `Set-Cookie` it returns is replayed on later requests, and
 * the guards resolve it through `auth.api.getSession` exactly as they do in production. That
 * is the point — `tests/guards.test.ts` already covers the guards against a stubbed session,
 * and a stub cannot tell you whether the cookie, the CORS/credential setup or the adapter
 * actually work.
 */
export const API = API_PREFIX;
export const AUTH = `${API_PREFIX}/auth`;

/** Satisfies the 12-character minimum in `emailAndPassword.minPasswordLength`. */
export const TEST_PASSWORD = 'Correct-Horse-Battery-9';

/**
 * The Origin header a real browser would send. Cookie-bearing state-changing requests must
 * carry it: with `advanced.disableOriginCheck: false`, Better Auth refuses such a request
 * when the header is missing or `null` (MISSING_OR_NULL_ORIGIN), which is correct and is
 * why the tests set it rather than working around it.
 */
export const ORIGIN = env.FRONTEND_ORIGIN;

/**
 * Credential and write allowances are raised for the suite so that creating fixture
 * accounts does not trip a limiter the test in question is not about. `rate-limit.test.ts`
 * builds its own app with tight limits to prove the limiter refuses.
 */
const GENEROUS_LIMITS: RateLimitConfig = {
  credential: { windowMs: 60_000, limit: 10_000 },
  session: { windowMs: 60_000, limit: 10_000 },
  write: { windowMs: 60_000, limit: 10_000 },
};

export function createTestApp(overrides?: Partial<RateLimitConfig>): Express {
  return createApp({ rateLimits: { ...GENEROUS_LIMITS, ...overrides } });
}

/**
 * Empties the test database between files. Discovers the tables rather than hard-coding a
 * dependency order, and preserves `_prisma_migrations` — dropping it would make the next
 * `migrate deploy` try to replay everything.
 */
export async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (rows.length === 0) {
    throw new Error(
      'The test database has no tables. Apply migrations with DATABASE_URL pointed at it.',
    );
  }

  const list = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

/** A signed-in account: the cookie header to replay, plus the row it belongs to. */
export interface TestSession {
  readonly userId: string;
  readonly email: string;
  /** Ready for `.set('cookie', session.cookie)`. */
  readonly cookie: string;
}

/**
 * Collapses `Set-Cookie` into a request `Cookie` header. Attributes are dropped on purpose:
 * supertest is not a browser and would not enforce them. `cookies.test.ts` asserts the
 * attributes themselves.
 */
export function cookieFrom(headers: Record<string, unknown>): string {
  const raw = headers['set-cookie'];
  const list = Array.isArray(raw) ? (raw as string[]) : typeof raw === 'string' ? [raw] : [];

  return list
    .map((entry) => entry.split(';')[0])
    .filter((pair): pair is string => Boolean(pair))
    .join('; ');
}

export function uniqueEmail(prefix = 'shopper'): string {
  return `${prefix}-${randomUUID().slice(0, 12)}@example.test`;
}

/** Registers a customer through the real endpoint and returns its session. */
export async function signUp(
  app: Express,
  options: { email?: string; password?: string; name?: string } = {},
): Promise<TestSession> {
  const email = options.email ?? uniqueEmail();
  const password = options.password ?? TEST_PASSWORD;

  const res = await request(app)
    .post(`${AUTH}/sign-up/email`)
    .send({ email, password, name: options.name ?? 'Test Shopper' });

  if (res.status !== 200) {
    throw new Error(`sign-up failed with ${res.status}: ${JSON.stringify(res.body)}`);
  }

  const cookie = cookieFrom(res.headers);

  if (!cookie) {
    throw new Error('sign-up returned no session cookie');
  }

  const user = await prisma.user.findUniqueOrThrow({
    where: { email: email.toLowerCase() },
    select: { id: true },
  });

  return { userId: user.id, email: email.toLowerCase(), cookie };
}

export async function signIn(
  app: Express,
  email: string,
  password: string = TEST_PASSWORD,
): Promise<{ status: number; cookie: string; body: unknown }> {
  const res = await request(app).post(`${AUTH}/sign-in/email`).send({ email, password });

  return { status: res.status, cookie: cookieFrom(res.headers), body: res.body };
}

/**
 * Elevates an account the only way the application allows at bootstrap: a direct database
 * write, which is what `prisma/seed.ts` does for the first superadmin. Going through the
 * API is impossible by design — `role` is `input: false` in Better Auth and the admin role
 * endpoint already requires a superadmin.
 */
export async function setRole(userId: string, role: UserRole): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { role } });
}

export async function setStatus(userId: string, status: UserStatus): Promise<void> {
  await prisma.user.update({ where: { id: userId }, data: { status } });
}

/** A signed-in account at the given role. */
export async function signUpAs(
  app: Express,
  role: UserRole,
  options: { email?: string } = {},
): Promise<TestSession> {
  const session = await signUp(app, options);

  if (role !== UserRole.CUSTOMER) {
    await setRole(session.userId, role);
  }

  return session;
}

/**
 * Minimal persisted order for the ownership tests. Written with Prisma because checkout is
 * M6; the totals satisfy the `orders_total_consistent_check` CHECK
 * (total = subtotal - discount + shipping + tax).
 *
 * `userId: null` makes a guest order, which needs a `guestAccessTokenHash` to satisfy
 * `orders_reachable_owner_check` — an order has to be reachable by somebody.
 */
export async function makeOrder(userId: string | null): Promise<{ id: string }> {
  const subtotalMinor = 2500;
  const shippingMinor = 500;

  return prisma.order.create({
    data: {
      orderNumber: `ORD-${randomUUID().slice(0, 10).toUpperCase()}`,
      ...(userId
        ? { userId }
        : { guestAccessTokenHash: createHash('sha256').update(randomUUID()).digest('hex') }),
      paymentMethod: 'COD',
      currency: 'USD',
      subtotalMinor,
      discountMinor: 0,
      shippingMinor,
      taxMinor: 0,
      totalMinor: subtotalMinor + shippingMinor,
      contactEmail: uniqueEmail('buyer'),
      shipRecipientName: 'Test Person',
      shipLine1: '1 Test Street',
      shipCity: 'Testville',
      shipPostalCode: '12345',
      shipCountryCode: 'US',
    },
    select: { id: true },
  });
}

/** A valid address body for the account endpoints. */
export function addressPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    recipientName: 'Test Person',
    line1: '1 Test Street',
    city: 'Testville',
    postalCode: '12345',
    countryCode: 'us',
    ...overrides,
  };
}
