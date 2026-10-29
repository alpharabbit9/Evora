import { randomUUID } from 'node:crypto';

import { testDb } from './client.js';

/** Minimal rows the constraint and relation tests build on. Nothing here asserts anything. */

export async function makeUser(overrides: { email?: string; role?: 'CUSTOMER' | 'ADMIN' } = {}) {
  return testDb.user.create({
    data: {
      email: overrides.email ?? `user-${randomUUID()}@example.test`,
      name: 'Test Person',
      ...(overrides.role ? { role: overrides.role } : {}),
    },
  });
}

export async function makeCategory() {
  const suffix = randomUUID().slice(0, 8);
  return testDb.category.create({
    data: { name: `Category ${suffix}`, slug: `category-${suffix}` },
  });
}

export async function makeProduct(categoryId?: string) {
  const category = categoryId ?? (await makeCategory()).id;
  const suffix = randomUUID().slice(0, 8);
  return testDb.product.create({
    data: {
      name: `Product ${suffix}`,
      slug: `product-${suffix}`,
      categoryId: category,
      status: 'PUBLISHED',
      publishedAt: new Date(),
    },
  });
}

export async function makeVariant(
  options: { productId?: string; stockQuantity?: number; priceMinor?: number } = {},
) {
  const productId = options.productId ?? (await makeProduct()).id;
  return testDb.productVariant.create({
    data: {
      productId,
      sku: `SKU-${randomUUID().slice(0, 12).toUpperCase()}`,
      optionKey: `opt-${randomUUID().slice(0, 8)}`,
      priceMinor: options.priceMinor ?? 1500,
      stockQuantity: options.stockQuantity ?? 10,
    },
  });
}

interface OrderOverrides {
  userId?: string | null;
  subtotalMinor?: number;
  discountMinor?: number;
  shippingMinor?: number;
  taxMinor?: number;
  totalMinor?: number;
  guestAccessTokenHash?: string | null;
}

export async function makeOrder(overrides: OrderOverrides = {}) {
  const subtotal = overrides.subtotalMinor ?? 1500;
  const discount = overrides.discountMinor ?? 0;
  const shipping = overrides.shippingMinor ?? 500;
  const tax = overrides.taxMinor ?? 0;
  const guest = overrides.guestAccessTokenHash;
  const userId = overrides.userId === undefined ? (await makeUser()).id : overrides.userId;

  return testDb.order.create({
    data: {
      orderNumber: `ORD-${randomUUID().slice(0, 10).toUpperCase()}`,
      ...(userId ? { userId } : {}),
      ...(guest ? { guestAccessTokenHash: guest } : {}),
      paymentMethod: 'COD',
      currency: 'USD',
      subtotalMinor: subtotal,
      discountMinor: discount,
      shippingMinor: shipping,
      taxMinor: tax,
      totalMinor: overrides.totalMinor ?? subtotal - discount + shipping + tax,
      contactEmail: `buyer-${randomUUID().slice(0, 8)}@example.test`,
      shipRecipientName: 'Test Person',
      shipLine1: '1 Test Street',
      shipCity: 'Testville',
      shipPostalCode: '12345',
      shipCountryCode: 'US',
    },
  });
}
