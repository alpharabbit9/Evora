import { randomUUID } from 'node:crypto';

import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { expectRejection, testDb, truncateAll } from './client.js';
import { makeOrder, makeProduct, makeUser, makeVariant } from './fixtures.js';

/**
 * The hand-written CHECK constraints and partial unique indexes live in migration SQL, not
 * in schema.prisma, so Prisma does not know about them and a future `migrate dev` could
 * generate a DROP for one. The existence sweep below is what turns that into a failing test
 * instead of a silent loss of an invariant.
 */
const EXPECTED_CHECKS = [
  'users_email_lowercase_check',
  'addresses_country_code_check',
  'addresses_one_default_per_user_key',
  'categories_parent_not_self_check',
  'products_published_requires_timestamp_check',
  'products_source_identity_check',
  'products_featured_rank_positive_check',
  'product_variants_stock_non_negative_check',
  'product_variants_price_minor_check',
  'product_images_alt_text_not_blank_check',
  'carts_single_owner_check',
  'carts_one_active_per_user_key',
  'carts_one_active_per_guest_key',
  'cart_items_quantity_range_check',
  'coupons_code_uppercase_check',
  'coupons_value_matches_type_check',
  'coupons_used_within_limit_check',
  'orders_total_identity_check',
  'orders_discount_within_subtotal_check',
  'orders_reachable_owner_check',
  'orders_idempotency_pair_check',
  'order_items_line_total_identity_check',
  'order_status_history_actor_check',
  'payments_captured_requires_success_check',
  'refunds_amount_check',
  'webhook_events_processed_timestamp_check',
  'inventory_movements_delta_check',
  'inventory_movements_actor_check',
  'outbox_events_sent_timestamp_check',
  'audit_logs_actor_check',
];

beforeAll(async () => {
  await truncateAll();
});

afterAll(async () => {
  await testDb.$disconnect();
});

describe('hand-written database objects still exist', () => {
  it('has every expected CHECK constraint and partial unique index', async () => {
    const constraints = await testDb.$queryRaw<{ name: string }[]>`
      SELECT conname AS name FROM pg_constraint WHERE contype = 'c'
      UNION ALL
      SELECT indexname AS name FROM pg_indexes WHERE schemaname = 'public'
    `;

    const present = new Set(constraints.map((row) => row.name));
    const missing = EXPECTED_CHECKS.filter((name) => !present.has(name));

    expect(missing, `Missing from the database: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('inventory cannot go negative', () => {
  it('rejects a direct negative stock write', async () => {
    const variant = await makeVariant({ stockQuantity: 1 });

    await expectRejection(
      () =>
        testDb.productVariant.update({
          where: { id: variant.id },
          data: { stockQuantity: -1 },
        }),
      'product_variants_stock_non_negative_check',
    );
  });

  it('rejects the conditional decrement when stock is already exhausted', async () => {
    const variant = await makeVariant({ stockQuantity: 1 });

    // The claim pattern from architecture.md §8: the WHERE clause is what makes it safe.
    const firstClaim = await testDb.$executeRaw`
      UPDATE product_variants SET stock_quantity = stock_quantity - 1
      WHERE id = ${variant.id} AND stock_quantity >= 1
    `;
    const secondClaim = await testDb.$executeRaw`
      UPDATE product_variants SET stock_quantity = stock_quantity - 1
      WHERE id = ${variant.id} AND stock_quantity >= 1
    `;

    expect(firstClaim).toBe(1);
    expect(secondClaim).toBe(0); // no row claimed: the caller must treat this as out of stock

    const after = await testDb.productVariant.findUniqueOrThrow({ where: { id: variant.id } });
    expect(after.stockQuantity).toBe(0);
  });

  it('requires a signed delta on every movement', async () => {
    const variant = await makeVariant({ stockQuantity: 5 });
    const admin = await makeUser({ role: 'ADMIN' });

    await expectRejection(
      () =>
        testDb.inventoryMovement.create({
          data: {
            variantId: variant.id,
            delta: 0,
            resultingQuantity: 5,
            reason: 'ADMIN_ADJUSTMENT',
            actorUserId: admin.id,
          },
        }),
      'inventory_movements_delta_check',
    );
  });

  it('rejects a movement whose resulting balance is negative', async () => {
    const variant = await makeVariant({ stockQuantity: 5 });

    await expectRejection(
      () =>
        testDb.inventoryMovement.create({
          data: { variantId: variant.id, delta: -6, resultingQuantity: -1, reason: 'ORDER_PLACED' },
        }),
      'inventory_movements_resulting_quantity_check',
    );
  });

  it('requires an actor on a manual stock adjustment but not on a system movement', async () => {
    const variant = await makeVariant({ stockQuantity: 5 });

    await expectRejection(
      () =>
        testDb.inventoryMovement.create({
          data: {
            variantId: variant.id,
            delta: -1,
            resultingQuantity: 4,
            reason: 'ADMIN_ADJUSTMENT',
          },
        }),
      'inventory_movements_actor_check',
    );

    const systemMovement = await testDb.inventoryMovement.create({
      data: { variantId: variant.id, delta: -1, resultingQuantity: 4, reason: 'ORDER_PLACED' },
    });
    expect(systemMovement.actorUserId).toBeNull();
  });
});

describe('order totals cannot be stored inconsistently', () => {
  it('rejects a total that does not equal subtotal - discount + shipping + tax', async () => {
    await expectRejection(
      () => makeOrder({ subtotalMinor: 1000, shippingMinor: 500, totalMinor: 999 }),
      'orders_total_identity_check',
    );
  });

  it('rejects a discount larger than the subtotal', async () => {
    // Shipping of 500 keeps the total at 0 so that `orders_total_identity_check` and
    // `orders_money_non_negative_check` both hold and the discount guard is the ONLY thing
    // violated. The previous fixture (shipping 0, total -500) tripped three constraints at
    // once, and PostgreSQL reports whichever it evaluates first, so the assertion depended
    // on evaluation order rather than on the rule it claimed to test.
    await expectRejection(
      () =>
        makeOrder({ subtotalMinor: 1000, discountMinor: 1500, shippingMinor: 500, totalMinor: 0 }),
      'orders_discount_within_subtotal_check',
    );
  });

  it('rejects a negative money amount', async () => {
    // subtotal - discount + shipping + tax = 1000 - 0 + (-500) + 0 = 500, so the total
    // identity holds and the discount is within the subtotal: only the non-negative guard
    // is violated.
    await expectRejection(
      () =>
        makeOrder({ subtotalMinor: 1000, discountMinor: 0, shippingMinor: -500, totalMinor: 500 }),
      'orders_money_non_negative_check',
    );
  });

  it('rejects an order line whose total does not match its own arithmetic', async () => {
    const order = await makeOrder();

    await expectRejection(
      () =>
        testDb.orderItem.create({
          data: {
            orderId: order.id,
            productNameSnapshot: 'Snapshot',
            skuSnapshot: 'SKU-1',
            unitPriceMinor: 500,
            quantity: 2,
            lineTotalMinor: 999,
          },
        }),
      'order_items_line_total_identity_check',
    );
  });

  it('accepts a consistent order line', async () => {
    const order = await makeOrder();

    const item = await testDb.orderItem.create({
      data: {
        orderId: order.id,
        productNameSnapshot: 'Snapshot',
        skuSnapshot: 'SKU-2',
        unitPriceMinor: 500,
        quantity: 2,
        lineDiscountMinor: 100,
        lineTaxMinor: 50,
        lineTotalMinor: 500 * 2 - 100 + 50,
      },
    });

    expect(item.lineTotalMinor).toBe(950);
  });
});

describe('an order is always reachable by its owner', () => {
  it('rejects an order with neither a user nor a guest access token', async () => {
    await expectRejection(() => makeOrder({ userId: null }), 'orders_reachable_owner_check');
  });

  it('accepts a guest order carrying an access token hash', async () => {
    const order = await makeOrder({ userId: null, guestAccessTokenHash: randomUUID() });
    expect(order.userId).toBeNull();
    expect(order.guestAccessTokenHash).not.toBeNull();
  });

  it('requires the idempotency key and request fingerprint together', async () => {
    const order = await makeOrder();

    await expectRejection(
      () =>
        testDb.order.update({
          where: { id: order.id },
          data: { idempotencyKey: randomUUID() },
        }),
      'orders_idempotency_pair_check',
    );
  });
});

describe('cart ownership', () => {
  it('rejects a cart owned by both a user and a guest token', async () => {
    const user = await makeUser();

    await expectRejection(
      () =>
        testDb.cart.create({
          data: { userId: user.id, guestTokenHash: randomUUID() },
        }),
      'carts_single_owner_check',
    );
  });

  it('rejects a cart owned by neither', async () => {
    await expectRejection(() => testDb.cart.create({ data: {} }), 'carts_single_owner_check');
  });

  it('allows only one ACTIVE cart per user, but any number of closed ones', async () => {
    const user = await makeUser();
    await testDb.cart.create({ data: { userId: user.id } });

    await expectRejection(
      () => testDb.cart.create({ data: { userId: user.id } }),
      'carts_one_active_per_user_key',
    );

    const abandoned = await testDb.cart.create({
      data: { userId: user.id, status: 'ABANDONED' },
    });
    expect(abandoned.status).toBe('ABANDONED');
  });

  it('rejects a non-positive cart quantity', async () => {
    const user = await makeUser();
    const cart = await testDb.cart.create({ data: { userId: user.id } });
    const variant = await makeVariant();

    await expectRejection(
      () =>
        testDb.cartItem.create({ data: { cartId: cart.id, variantId: variant.id, quantity: 0 } }),
      'cart_items_quantity_range_check',
    );
  });
});

describe('coupon configuration', () => {
  it('stores codes upper-cased', async () => {
    await expectRejection(
      () => testDb.coupon.create({ data: { code: 'summer10', type: 'PERCENT', percentBps: 1000 } }),
      'coupons_code_uppercase_check',
    );
  });

  it('rejects a PERCENT coupon that carries a fixed amount', async () => {
    await expectRejection(
      () =>
        testDb.coupon.create({
          data: { code: 'BROKEN1', type: 'PERCENT', percentBps: 1000, valueMinor: 500 },
        }),
      'coupons_value_matches_type_check',
    );
  });

  it('rejects a FIXED coupon with no currency', async () => {
    await expectRejection(
      () => testDb.coupon.create({ data: { code: 'BROKEN2', type: 'FIXED', valueMinor: 500 } }),
      'coupons_value_matches_type_check',
    );
  });

  it('cannot be redeemed beyond its usage limit', async () => {
    const coupon = await testDb.coupon.create({
      data: { code: 'LIMIT2', type: 'FIXED', valueMinor: 500, currency: 'USD', usageLimit: 2 },
    });

    // The claim UPDATE the pricing service will use; the CHECK is the backstop behind it.
    const claim = async (): Promise<number> =>
      testDb.$executeRaw`
        UPDATE coupons SET used_count = used_count + 1
        WHERE id = ${coupon.id} AND (usage_limit IS NULL OR used_count < usage_limit)
      `;

    expect(await claim()).toBe(1);
    expect(await claim()).toBe(1);
    expect(await claim()).toBe(0); // limit reached, no row claimed

    await expectRejection(
      () => testDb.coupon.update({ where: { id: coupon.id }, data: { usedCount: 3 } }),
      'coupons_used_within_limit_check',
    );
  });
});

describe('payment and webhook invariants', () => {
  it('deduplicates provider events by (provider, eventId)', async () => {
    const event = {
      provider: 'sandbox',
      eventId: `evt_${randomUUID()}`,
      eventType: 'payment.succeeded',
      payloadHash: 'hash',
    };

    await testDb.webhookEvent.create({ data: event });

    await expectRejection(
      () => testDb.webhookEvent.create({ data: event }),
      'webhook_events_provider_event_id_key',
    );
  });

  it('cannot mark an event PROCESSED without a processed timestamp', async () => {
    const created = await testDb.webhookEvent.create({
      data: {
        provider: 'sandbox',
        eventId: `evt_${randomUUID()}`,
        eventType: 'payment.succeeded',
        payloadHash: 'hash',
      },
    });

    await expectRejection(
      () =>
        testDb.webhookEvent.update({ where: { id: created.id }, data: { status: 'PROCESSED' } }),
      'webhook_events_processed_timestamp_check',
    );
  });

  it('cannot record a capture on a payment that has not succeeded', async () => {
    const order = await makeOrder();

    await expectRejection(
      () =>
        testDb.payment.create({
          data: {
            orderId: order.id,
            provider: 'sandbox',
            method: 'ONLINE',
            status: 'PENDING',
            amountMinor: order.totalMinor,
            currency: 'USD',
            capturedAt: new Date(),
          },
        }),
      'payments_captured_requires_success_check',
    );
  });

  it('cannot create two refunds with the same idempotency key', async () => {
    const order = await makeOrder();
    const payment = await testDb.payment.create({
      data: {
        orderId: order.id,
        provider: 'sandbox',
        method: 'ONLINE',
        status: 'SUCCEEDED',
        amountMinor: order.totalMinor,
        currency: 'USD',
      },
    });

    const key = `refund_${randomUUID()}`;
    await testDb.refund.create({
      data: {
        paymentId: payment.id,
        orderId: order.id,
        amountMinor: 100,
        currency: 'USD',
        idempotencyKey: key,
      },
    });

    await expectRejection(
      () =>
        testDb.refund.create({
          data: {
            paymentId: payment.id,
            orderId: order.id,
            amountMinor: 100,
            currency: 'USD',
            idempotencyKey: key,
          },
        }),
      'refunds_idempotency_key_key',
    );
  });
});

describe('identity and catalog invariants', () => {
  it('rejects a mixed-case email, so no case-variant duplicate identity can exist', async () => {
    await expectRejection(
      () => makeUser({ email: 'Mixed.Case@Example.test' }),
      'users_email_lowercase_check',
    );
  });

  it('rejects a published product with no publication timestamp', async () => {
    const category = await testDb.category.create({
      data: { name: 'Temp', slug: `temp-${randomUUID().slice(0, 8)}` },
    });

    await expectRejection(
      () =>
        testDb.product.create({
          data: {
            name: 'No timestamp',
            slug: `no-ts-${randomUUID().slice(0, 8)}`,
            categoryId: category.id,
            status: 'PUBLISHED',
          },
        }),
      'products_published_requires_timestamp_check',
    );
  });

  it('rejects a half-set import identity, which the unique index could not deduplicate', async () => {
    const category = await testDb.category.create({
      data: { name: 'Temp', slug: `temp-${randomUUID().slice(0, 8)}` },
    });

    await expectRejection(
      () =>
        testDb.product.create({
          data: {
            name: 'Half identity',
            slug: `half-${randomUUID().slice(0, 8)}`,
            categoryId: category.id,
            sourceProvider: 'fashion-product-images',
          },
        }),
      'products_source_identity_check',
    );
  });

  it('allows one product per import identity', async () => {
    const category = await testDb.category.create({
      data: { name: 'Temp', slug: `temp-${randomUUID().slice(0, 8)}` },
    });
    const identity = { sourceProvider: 'test-source', sourceExternalId: '42' };

    await testDb.product.create({
      data: {
        name: 'First',
        slug: `first-${randomUUID().slice(0, 8)}`,
        categoryId: category.id,
        ...identity,
      },
    });

    await expectRejection(
      () =>
        testDb.product.create({
          data: {
            name: 'Second',
            slug: `second-${randomUUID().slice(0, 8)}`,
            categoryId: category.id,
            ...identity,
          },
        }),
      'products_source_provider_source_external_id_key',
    );
  });

  it('rejects a category that is its own parent', async () => {
    const category = await testDb.category.create({
      data: { name: 'Self', slug: `self-${randomUUID().slice(0, 8)}` },
    });

    await expectRejection(
      () => testDb.category.update({ where: { id: category.id }, data: { parentId: category.id } }),
      'categories_parent_not_self_check',
    );
  });

  it('rejects a second variant with the same option combination on one product', async () => {
    const product = await makeProduct();
    await testDb.productVariant.create({
      data: {
        productId: product.id,
        sku: `A-${randomUUID().slice(0, 8)}`,
        optionKey: 'color:red',
        priceMinor: 100,
      },
    });

    await expectRejection(
      () =>
        testDb.productVariant.create({
          data: {
            productId: product.id,
            sku: `B-${randomUUID().slice(0, 8)}`,
            optionKey: 'color:red',
            priceMinor: 100,
          },
        }),
      'product_variants_product_id_option_key_key',
    );
  });

  it('requires alt text on every product image', async () => {
    const product = await makeProduct();

    await expectRejection(
      () =>
        testDb.productImage.create({
          data: { productId: product.id, objectKey: `key-${randomUUID()}`, altText: '   ' },
        }),
      'product_images_alt_text_not_blank_check',
    );
  });

  it('allows at most one default address per user', async () => {
    const user = await makeUser();
    const address = {
      userId: user.id,
      recipientName: 'Test Person',
      line1: '1 Test Street',
      city: 'Testville',
      postalCode: '12345',
      countryCode: 'US',
      isDefault: true,
    };

    await testDb.address.create({ data: address });

    await expectRejection(
      () => testDb.address.create({ data: address }),
      'addresses_one_default_per_user_key',
    );

    const second = await testDb.address.create({ data: { ...address, isDefault: false } });
    expect(second.isDefault).toBe(false);
  });

  it('rejects a lower-case country code', async () => {
    const user = await makeUser();

    await expectRejection(
      () =>
        testDb.address.create({
          data: {
            userId: user.id,
            recipientName: 'Test Person',
            line1: '1 Test Street',
            city: 'Testville',
            postalCode: '12345',
            countryCode: 'us',
          },
        }),
      'addresses_country_code_check',
    );
  });
});

describe('audit and outbox attribution', () => {
  it('rejects an audit entry with no actor and no system flag', async () => {
    await expectRejection(
      () => testDb.auditLog.create({ data: { action: 'product.update', entityType: 'Product' } }),
      'audit_logs_actor_check',
    );
  });

  it('accepts a system-attributed audit entry', async () => {
    const entry = await testDb.auditLog.create({
      data: { action: 'order.expire', entityType: 'Order', isSystem: true },
    });
    expect(entry.isSystem).toBe(true);
  });

  it('cannot mark an outbox job SENT without a processed timestamp', async () => {
    const job = await testDb.outboxEvent.create({
      data: { eventType: 'ORDER_RECEIPT', dedupeKey: `job-${randomUUID()}`, payload: {} },
    });

    await expectRejection(
      () => testDb.outboxEvent.update({ where: { id: job.id }, data: { status: 'SENT' } }),
      'outbox_events_sent_timestamp_check',
    );
  });
});
