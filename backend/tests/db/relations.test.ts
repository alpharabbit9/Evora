import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { errorText, expectRejection, testDb, truncateAll } from './client.js';
import { makeOrder, makeProduct, makeUser, makeVariant } from './fixtures.js';

/**
 * Deletion behaviour is the part of the schema that decides whether financial history can
 * be destroyed. Every referential action in schema.prisma is deliberate, so each one is
 * asserted here rather than trusted.
 */

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('identity cascades', () => {
  it('removes sessions and accounts with the user, as Better Auth expects', async () => {
    const user = await makeUser();
    await testDb.session.create({
      data: {
        userId: user.id,
        token: `tok_${randomUUID()}`,
        expiresAt: new Date(Date.now() + 86_400_000),
      },
    });
    await testDb.account.create({
      data: { userId: user.id, accountId: user.id, providerId: 'credential', password: 'hashed' },
    });

    await testDb.user.delete({ where: { id: user.id } });

    expect(await testDb.session.count({ where: { userId: user.id } })).toBe(0);
    expect(await testDb.account.count({ where: { userId: user.id } })).toBe(0);
  });

  it('removes saved addresses with the user, because orders keep their own snapshot', async () => {
    const user = await makeUser();
    await testDb.address.create({
      data: {
        userId: user.id,
        recipientName: 'Test Person',
        line1: '1 Test Street',
        city: 'Testville',
        postalCode: '12345',
        countryCode: 'US',
      },
    });

    await testDb.user.delete({ where: { id: user.id } });
    expect(await testDb.address.count({ where: { userId: user.id } })).toBe(0);
  });
});

describe('financial records survive', () => {
  it('refuses to delete a user who has an order', async () => {
    const user = await makeUser();
    await makeOrder({ userId: user.id });

    // onDelete: Restrict. Account closure has to be anonymization, not deletion — the
    // retention policy itself is still an open decision (PRD §9).
    let message = '';
    try {
      await testDb.user.delete({ where: { id: user.id } });
    } catch (error) {
      message = errorText(error);
    }

    expect(message).not.toBe('');
    expect(await testDb.user.count({ where: { id: user.id } })).toBe(1);
  });

  it('keeps order line snapshots when the product is deleted outright', async () => {
    const product = await makeProduct();
    const variant = await makeVariant({ productId: product.id });
    const order = await makeOrder();

    await testDb.orderItem.create({
      data: {
        orderId: order.id,
        productId: product.id,
        variantId: variant.id,
        productNameSnapshot: 'Original Product Name',
        skuSnapshot: variant.sku,
        unitPriceMinor: 1500,
        quantity: 1,
        lineTotalMinor: 1500,
      },
    });

    // Production policy is archive, not delete. This proves that even a hard delete cannot
    // cascade into order history or rewrite what the customer actually bought.
    await testDb.product.delete({ where: { id: product.id } });

    const items = await testDb.orderItem.findMany({ where: { orderId: order.id } });
    expect(items).toHaveLength(1);
    expect(items[0]?.productId).toBeNull();
    expect(items[0]?.variantId).toBeNull();
    expect(items[0]?.productNameSnapshot).toBe('Original Product Name');
    expect(items[0]?.skuSnapshot).toBe(variant.sku);
    expect(items[0]?.unitPriceMinor).toBe(1500);
  });

  it('keeps the historical unit price when the catalog price changes', async () => {
    const variant = await makeVariant({ priceMinor: 1500 });
    const order = await makeOrder();

    await testDb.orderItem.create({
      data: {
        orderId: order.id,
        variantId: variant.id,
        productNameSnapshot: 'Snapshot',
        skuSnapshot: variant.sku,
        unitPriceMinor: 1500,
        quantity: 1,
        lineTotalMinor: 1500,
      },
    });

    await testDb.productVariant.update({ where: { id: variant.id }, data: { priceMinor: 9900 } });

    const item = await testDb.orderItem.findFirstOrThrow({ where: { orderId: order.id } });
    expect(item.unitPriceMinor).toBe(1500);
  });

  it('refuses to delete an order that has a payment', async () => {
    const order = await makeOrder();
    await testDb.payment.create({
      data: {
        orderId: order.id,
        provider: 'sandbox',
        method: 'COD',
        amountMinor: order.totalMinor,
        currency: 'USD',
      },
    });

    let message = '';
    try {
      await testDb.order.delete({ where: { id: order.id } });
    } catch (error) {
      message = errorText(error);
    }

    expect(message).not.toBe('');
    expect(await testDb.order.count({ where: { id: order.id } })).toBe(1);
  });

  it('refuses to delete a variant that has inventory history', async () => {
    const variant = await makeVariant({ stockQuantity: 3 });
    await testDb.inventoryMovement.create({
      data: { variantId: variant.id, delta: -1, resultingQuantity: 2, reason: 'ORDER_PLACED' },
    });

    let message = '';
    try {
      await testDb.productVariant.delete({ where: { id: variant.id } });
    } catch (error) {
      message = errorText(error);
    }

    expect(message).not.toBe('');
  });
});

describe('ownership and containment', () => {
  it('removes cart items with their cart', async () => {
    const user = await makeUser();
    const cart = await testDb.cart.create({ data: { userId: user.id } });
    const variant = await makeVariant();
    await testDb.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity: 2 } });

    await testDb.cart.delete({ where: { id: cart.id } });
    expect(await testDb.cartItem.count({ where: { cartId: cart.id } })).toBe(0);
  });

  it('removes variants and images with their product', async () => {
    const product = await makeProduct();
    const variant = await makeVariant({ productId: product.id });
    await testDb.productImage.create({
      data: {
        productId: product.id,
        variantId: variant.id,
        objectKey: `key-${randomUUID()}`,
        altText: 'A product photo',
      },
    });

    await testDb.product.delete({ where: { id: product.id } });

    expect(await testDb.productVariant.count({ where: { productId: product.id } })).toBe(0);
    expect(await testDb.productImage.count({ where: { productId: product.id } })).toBe(0);
  });

  /**
   * UNRESOLVED SCHEMA CONFLICT — this test asserts what the database actually does, which
   * is not what the schema appears to promise.
   *
   * `OrderStatusHistory.actorUserId` declares `onDelete: SetNull`, so deleting the acting
   * admin should leave the trail behind with a null actor. But the hand-written CHECK
   * `order_status_history_actor_check` requires `actor_user_id IS NOT NULL OR is_system`,
   * and `is_system` is false on an admin-caused transition. The cascade therefore tries to
   * write a row the CHECK forbids, and the DELETE is refused.
   *
   * The two rules are mutually exclusive: with this CHECK in place, `SetNull` can never
   * fire for an admin-caused row. `AuditLog.actorUserId` has exactly the same pairing, so
   * an administrator who has performed any audited action cannot be deleted either.
   *
   * Refusing the delete is arguably the right outcome for an append-only trail, but it is
   * not what the schema says, and the retention/deletion policy is still open
   * (architecture.md §16). Resolving it needs an ADR choosing one of: forbid user deletion
   * outright and drop the misleading `SetNull`; or let the trail keep a null actor by
   * setting `is_system` in the cascade, which SQL alone cannot express; or anonymise the
   * user row instead of deleting it. This test records today's behaviour so the decision is
   * made deliberately rather than discovered by a failing delete in production.
   *
   * It originally asserted the SetNull outcome and had never run — the suite could not
   * start because nothing loaded backend/.env (fixed in tests/db/client.ts).
   */
  it('refuses to delete an admin whose actions are recorded in an order status trail', async () => {
    const admin = await makeUser({ role: 'ADMIN' });
    const order = await makeOrder();
    await testDb.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        actorUserId: admin.id,
        reason: 'Payment verified',
      },
    });

    await expectRejection(
      () => testDb.user.delete({ where: { id: admin.id } }),
      'order_status_history_actor_check',
    );

    // The trail is intact and still names its actor.
    const history = await testDb.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.actorUserId).toBe(admin.id);
    expect(history[0]?.toStatus).toBe('CONFIRMED');
  });

  it('keeps a system-attributed status trail when the user row goes away', async () => {
    // The half of SetNull that does work: `is_system` already satisfies the CHECK, so the
    // cascade can null the actor without violating it.
    const admin = await makeUser({ role: 'ADMIN' });
    const order = await makeOrder();
    await testDb.orderStatusHistory.create({
      data: {
        orderId: order.id,
        fromStatus: 'PENDING_PAYMENT',
        toStatus: 'CONFIRMED',
        actorUserId: admin.id,
        isSystem: true,
        reason: 'Payment verified by webhook',
      },
    });

    await testDb.user.delete({ where: { id: admin.id } });

    const history = await testDb.orderStatusHistory.findMany({ where: { orderId: order.id } });
    expect(history).toHaveLength(1);
    expect(history[0]?.actorUserId).toBeNull();
    expect(history[0]?.toStatus).toBe('CONFIRMED');
  });
});
