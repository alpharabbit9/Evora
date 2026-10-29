import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import {
  API,
  ORIGIN,
  addressPayload,
  createTestApp,
  makeOrder,
  signIn,
  signUp,
  signUpAs,
  truncateAll,
  uniqueEmail,
} from './harness.js';

/**
 * Authorization and resource ownership against the real app (PRD §3: "Hiding controls in
 * the UI is not authorization. Use least privilege and test direct API calls").
 *
 * Every request here is a direct API call with a genuine session cookie, which is the only
 * way to show that the server — not a hidden button — is what refuses.
 */
const app = createTestApp();

beforeAll(truncateAll);
afterAll(async () => {
  await prisma.$disconnect();
});

describe('role-based access to the admin subtree', () => {
  it('refuses an anonymous caller with 401', async () => {
    const res = await request(app).get(`${API}/admin/customers`);

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('refuses a customer with 403', async () => {
    const customer = await signUp(app);

    const res = await request(app).get(`${API}/admin/customers`).set('cookie', customer.cookie);

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('allows an admin', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);

    const res = await request(app).get(`${API}/admin/customers`).set('cookie', admin.cookie);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta.pageSize).toBeTypeOf('number');
  });

  it('allows a superadmin, because the ladder is a minimum and not an exact match', async () => {
    const superadmin = await signUpAs(app, UserRole.SUPERADMIN);

    const res = await request(app).get(`${API}/admin/customers`).set('cookie', superadmin.cookie);

    expect(res.status).toBe(200);
  });

  it('does not leak password hashes in the customer listing', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    await signUp(app);

    const res = await request(app).get(`${API}/admin/customers`).set('cookie', admin.cookie);

    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('password');
    expect(payload).not.toContain('token');
  });

  it('rejects an unknown filter value instead of querying with it', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);

    const res = await request(app)
      .get(`${API}/admin/customers`)
      .query({ role: 'GOD_MODE' })
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('caps the page size server-side', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);

    const res = await request(app)
      .get(`${API}/admin/customers`)
      .query({ pageSize: 5000 })
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN);

    expect(res.status).toBe(400);
  });
});

describe('privilege escalation', () => {
  it('refuses a role field on PATCH /me instead of silently dropping it', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ name: 'Still A Customer', role: 'ADMIN' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');

    const user = await prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      select: { role: true, name: true },
    });
    expect(user.role).toBe('CUSTOMER');
    // The whole request was refused, so the legitimate half did not take effect either.
    expect(user.name).toBe('Test Shopper');
  });

  it('refuses a status field on PATCH /me', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'ACTIVE' });

    expect(res.status).toBe(400);
  });

  it('refuses role and status on the Better Auth update-user endpoint', async () => {
    const customer = await signUp(app);

    // `input: false` does more than drop these fields: Better Auth 1.7 refuses the whole
    // payload, so the escalation attempt fails loudly instead of looking successful.
    const withPrivilegeFields = await request(app)
      .post(`${API}/auth/update-user`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ name: 'Renamed', role: 'ADMIN', status: 'SUSPENDED' });
    expect(withPrivilegeFields.status).toBe(400);

    const unchanged = await prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      select: { role: true, status: true, name: true },
    });
    expect(unchanged.role).toBe('CUSTOMER');
    expect(unchanged.status).toBe('ACTIVE');
    expect(unchanged.name).toBe('Test Shopper');

    // The same endpoint still works for the fields a user is allowed to change, which is
    // what shows the 400 above was about the privilege fields and not about the route.
    const nameOnly = await request(app)
      .post(`${API}/auth/update-user`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ name: 'Renamed' });
    expect(nameOnly.status).toBe(200);

    const after = await prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      select: { role: true, name: true },
    });
    expect(after.name).toBe('Renamed');
    expect(after.role).toBe('CUSTOMER');
  });

  it('refuses a customer trying to grant itself a role through the admin endpoint', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/role`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
    const user = await prisma.user.findUniqueOrThrow({
      where: { id: customer.userId },
      select: { role: true },
    });
    expect(user.role).toBe('CUSTOMER');
  });

  it('refuses an admin granting a role: that is superadmin-only', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/role`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(403);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: customer.userId },
          select: { role: true },
        })
      ).role,
    ).toBe('CUSTOMER');
  });

  it('refuses a superadmin changing its own role, so self-demotion cannot lock the store out', async () => {
    const superadmin = await signUpAs(app, UserRole.SUPERADMIN);

    const res = await request(app)
      .patch(`${API}/admin/customers/${superadmin.userId}/role`)
      .set('cookie', superadmin.cookie)
      .set('origin', ORIGIN)
      .send({ role: 'CUSTOMER' });

    expect(res.status).toBe(403);
  });
});

describe('admin management operations', () => {
  it('lets a superadmin promote a customer, and audits it', async () => {
    const superadmin = await signUpAs(app, UserRole.SUPERADMIN);
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/role`)
      .set('cookie', superadmin.cookie)
      .set('origin', ORIGIN)
      .send({ role: 'ADMIN' });

    expect(res.status).toBe(200);
    expect(res.body.data.role).toBe('ADMIN');

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'customer.role.updated', entityId: customer.userId },
    });
    expect(audit.actorUserId).toBe(superadmin.userId);
    expect(audit.actorRole).toBe('SUPERADMIN');
    expect(audit.beforeData).toEqual({ role: 'CUSTOMER' });
    expect(audit.afterData).toEqual({ role: 'ADMIN' });
    expect(audit.requestId).toBeTypeOf('string');
  });

  it('takes effect on the promoted account immediately, with no re-login', async () => {
    const superadmin = await signUpAs(app, UserRole.SUPERADMIN);
    const customer = await signUp(app);

    expect(
      (await request(app).get(`${API}/admin/customers`).set('cookie', customer.cookie)).status,
    ).toBe(403);

    await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/role`)
      .set('cookie', superadmin.cookie)
      .set('origin', ORIGIN)
      .send({ role: 'ADMIN' });

    // The same cookie now passes: the role is read from the database per request, because
    // `session.cookieCache` is disabled.
    expect(
      (await request(app).get(`${API}/admin/customers`).set('cookie', customer.cookie)).status,
    ).toBe(200);
  });

  it('lets an admin suspend a customer, and kills that customer live sessions', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const customer = await signUp(app);
    const customerSecondDevice = await signIn(app, customer.email);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/status`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('SUSPENDED');

    // Suspension bites now, not when the session would have expired in seven days.
    expect(await prisma.session.count({ where: { userId: customer.userId } })).toBe(0);
    expect((await request(app).get(`${API}/me`).set('cookie', customer.cookie)).status).toBe(401);
    expect(
      (await request(app).get(`${API}/me`).set('cookie', customerSecondDevice.cookie)).status,
    ).toBe(401);

    // And they cannot simply sign in again.
    const reSignIn = await signIn(app, customer.email);
    const afterSignIn = await request(app).get(`${API}/me`).set('cookie', reSignIn.cookie);
    expect(afterSignIn.status).toBe(403);

    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'customer.status.updated', entityId: customer.userId },
    });
    expect(audit.actorUserId).toBe(admin.userId);
  });

  it('refuses an admin suspending its own account', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);

    const res = await request(app)
      .patch(`${API}/admin/customers/${admin.userId}/status`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'SUSPENDED' });

    expect(res.status).toBe(403);
    expect((await request(app).get(`${API}/me`).set('cookie', admin.cookie)).status).toBe(200);
  });

  it('refuses an admin suspending a peer admin or the superadmin', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const peer = await signUpAs(app, UserRole.ADMIN);
    const owner = await signUpAs(app, UserRole.SUPERADMIN);

    for (const target of [peer, owner]) {
      const res = await request(app)
        .patch(`${API}/admin/customers/${target.userId}/status`)
        .set('cookie', admin.cookie)
        .set('origin', ORIGIN)
        .send({ status: 'SUSPENDED' });

      expect(res.status).toBe(403);
    }

    // A superadmin may, which is what keeps the operation possible at all.
    const bySuperadmin = await request(app)
      .patch(`${API}/admin/customers/${peer.userId}/status`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'SUSPENDED' });
    expect(bySuperadmin.status).toBe(200);
  });

  it('rejects an invalid status value', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/status`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'DELETED' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('refuses extra fields on an admin status change', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/admin/customers/${customer.userId}/status`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'SUSPENDED', role: 'SUPERADMIN' });

    expect(res.status).toBe(400);
  });

  it('writes no audit row when the change is refused', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const owner = await signUpAs(app, UserRole.SUPERADMIN);

    await request(app)
      .patch(`${API}/admin/customers/${owner.userId}/status`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN)
      .send({ status: 'SUSPENDED' });

    expect(await prisma.auditLog.count({ where: { entityId: owner.userId } })).toBe(0);
  });
});

describe('order ownership', () => {
  it('lets a customer read their own order', async () => {
    const customer = await signUp(app);
    const order = await makeOrder(customer.userId);

    const res = await request(app)
      .get(`${API}/orders/${order.id}`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(order.id);
  });

  it('refuses another customer order with 404, not 403', async () => {
    const owner = await signUp(app);
    const stranger = await signUp(app);
    const order = await makeOrder(owner.userId);

    const res = await request(app)
      .get(`${API}/orders/${order.id}`)
      .set('cookie', stranger.cookie)
      .set('origin', ORIGIN);

    // 404 on purpose: a 403 would confirm that this order id exists (API_SPEC.md §2).
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('lists only the caller own orders', async () => {
    const owner = await signUp(app);
    const stranger = await signUp(app);
    const own = await makeOrder(owner.userId);
    await makeOrder(stranger.userId);
    await makeOrder(null);

    const res = await request(app).get(`${API}/orders`).set('cookie', owner.cookie);

    expect(res.status).toBe(200);
    expect(res.body.data).toHaveLength(1);
    expect(res.body.data[0].id).toBe(own.id);
    expect(res.body.meta.total).toBe(1);
  });

  it('never exposes the guest access token hash or the idempotency key', async () => {
    const customer = await signUp(app);
    const order = await makeOrder(customer.userId);

    const res = await request(app)
      .get(`${API}/orders/${order.id}`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN);

    const payload = JSON.stringify(res.body);
    expect(payload).not.toContain('guestAccessTokenHash');
    expect(payload).not.toContain('idempotencyKey');
    expect(payload).not.toContain('requestFingerprint');
    expect(payload).not.toContain('userId');
  });

  it('lets an admin read any order, through the admin route', async () => {
    const admin = await signUpAs(app, UserRole.ADMIN);
    const customer = await signUp(app);
    const order = await makeOrder(customer.userId);

    // The customer route is owner-scoped even for an admin: admin access has its own route.
    const viaCustomerRoute = await request(app)
      .get(`${API}/orders/${order.id}`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN);
    expect(viaCustomerRoute.status).toBe(404);

    const viaAdminRoute = await request(app)
      .get(`${API}/admin/orders/${order.id}`)
      .set('cookie', admin.cookie)
      .set('origin', ORIGIN);
    expect(viaAdminRoute.status).toBe(200);
    expect(viaAdminRoute.body.data.id).toBe(order.id);
  });

  it('refuses a customer on the admin order route', async () => {
    const customer = await signUp(app);
    const order = await makeOrder(customer.userId);

    const res = await request(app)
      .get(`${API}/admin/orders/${order.id}`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN);

    expect(res.status).toBe(403);
  });
});

describe('address ownership', () => {
  it('creates and lists addresses for the caller only', async () => {
    const owner = await signUp(app);
    const stranger = await signUp(app);

    const created = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ label: 'Home', isDefault: true }));

    expect(created.status).toBe(201);
    // The schema upper-cases it, matching the CHECK constraint.
    expect(created.body.data.countryCode).toBe('US');
    expect(created.body.data.isDefault).toBe(true);

    const ownerList = await request(app)
      .get(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN);
    expect(ownerList.body.data).toHaveLength(1);

    const strangerList = await request(app)
      .get(`${API}/me/addresses`)
      .set('cookie', stranger.cookie)
      .set('origin', ORIGIN);
    expect(strangerList.body.data).toHaveLength(0);
  });

  it('refuses to update or delete another customer address', async () => {
    const owner = await signUp(app);
    const attacker = await signUp(app);

    const created = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload());
    const addressId = created.body.data.id as string;

    const patched = await request(app)
      .patch(`${API}/me/addresses/${addressId}`)
      .set('cookie', attacker.cookie)
      .set('origin', ORIGIN)
      .send({ city: 'Hijacked' });
    expect(patched.status).toBe(404);

    const deleted = await request(app)
      .delete(`${API}/me/addresses/${addressId}`)
      .set('cookie', attacker.cookie)
      .set('origin', ORIGIN);
    expect(deleted.status).toBe(404);

    // Untouched.
    const row = await prisma.address.findUniqueOrThrow({ where: { id: addressId } });
    expect(row.city).toBe('Testville');
    expect(row.userId).toBe(owner.userId);
  });

  it('cannot be re-pointed at another user by sending userId', async () => {
    const owner = await signUp(app);
    const attacker = await signUp(app);

    const res = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ userId: attacker.userId }));

    expect(res.status).toBe(400);
    // Neither account gained a row: the strict body refused the request outright.
    expect(await prisma.address.count({ where: { userId: attacker.userId } })).toBe(0);
    expect(await prisma.address.count({ where: { userId: owner.userId } })).toBe(0);
  });

  it('keeps at most one default address per user', async () => {
    const owner = await signUp(app);

    const first = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ label: 'First', isDefault: true }));
    const second = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ label: 'Second', isDefault: true }));

    expect(second.status).toBe(201);

    const defaults = await prisma.address.findMany({
      where: { userId: owner.userId, isDefault: true },
      select: { id: true },
    });
    expect(defaults).toHaveLength(1);
    expect(defaults[0]?.id).toBe(second.body.data.id);
    expect(first.body.data.id).not.toBe(second.body.data.id);
  });

  it('rejects a blank required field and an invalid country code', async () => {
    const owner = await signUp(app);

    const blank = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ recipientName: '   ' }));
    expect(blank.status).toBe(400);
    expect(blank.body.error.details[0].field).toBe('recipientName');

    const badCountry = await request(app)
      .post(`${API}/me/addresses`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send(addressPayload({ countryCode: 'USA' }));
    expect(badCountry.status).toBe(400);
  });

  it('rejects a malformed address id without touching the database', async () => {
    const owner = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me/addresses/' OR 1=1 --`)
      .set('cookie', owner.cookie)
      .set('origin', ORIGIN)
      .send({ city: 'Nowhere' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

describe('profile ownership', () => {
  it('updates only the caller own profile', async () => {
    const customer = await signUp(app);
    const other = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ name: 'Renamed By Owner' });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Renamed By Owner');

    // There is no route that takes a user id, so the other account cannot be addressed.
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: other.userId },
          select: { name: true },
        })
      ).name,
    ).toBe('Test Shopper');
  });

  it('refuses an email change through the profile route', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({ email: uniqueEmail('hijack') });

    expect(res.status).toBe(400);
    expect(
      (
        await prisma.user.findUniqueOrThrow({
          where: { id: customer.userId },
          select: { email: true },
        })
      ).email,
    ).toBe(customer.email);
  });

  it('refuses an empty update rather than making a no-op write', async () => {
    const customer = await signUp(app);

    const res = await request(app)
      .patch(`${API}/me`)
      .set('cookie', customer.cookie)
      .set('origin', ORIGIN)
      .send({});

    expect(res.status).toBe(400);
  });
});
