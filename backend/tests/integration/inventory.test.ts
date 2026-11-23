import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { makeCategory, makeProduct } from './catalog-fixtures.js';
import {
  API,
  ORIGIN,
  type TestSession,
  createTestApp,
  signUp,
  signUpAs,
  truncateAll,
} from './harness.js';

const app = createTestApp();
const ADMIN = `${API}/admin`;

let admin: TestSession;
let customer: TestSession;
let categoryId: string;
let variantId: string;

beforeAll(async () => {
  await truncateAll();
  admin = await signUpAs(app, UserRole.ADMIN);
  customer = await signUp(app);

  const cat = await makeCategory('inv-shoes', { name: 'Shoes' });
  categoryId = cat.id;

  const { variants } = await makeProduct({
    categoryId,
    name: 'Inventory Test Shoe',
    variants: [{ color: 'Black', size: 'M', stockQuantity: 20, lowStockThreshold: 5 }],
  });
  variantId = variants[0]!.id;
});

afterAll(async () => {
  await prisma.$disconnect();
});

function adminGet(path: string, session = admin) {
  return request(app).get(`${ADMIN}${path}`).set('cookie', session.cookie);
}

function adminPost(path: string, body: object, session = admin) {
  return request(app)
    .post(`${ADMIN}${path}`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .send(body);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('inventory authorization', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(`${ADMIN}/inventory`);
    expect(res.status).toBe(401);
  });

  it('rejects customers', async () => {
    const res = await adminGet('/inventory', customer);
    expect(res.status).toBe(403);
  });

  it('allows admin', async () => {
    const res = await adminGet('/inventory');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Inventory listing
// ---------------------------------------------------------------------------

describe('admin inventory listing', () => {
  it('lists variants with stock info', async () => {
    const res = await adminGet('/inventory');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);

    const { data } = res.body as {
      data: {
        id: string;
        stockQuantity: number;
        lowStockThreshold: number;
        isLowStock: boolean;
        product: unknown;
      }[];
    };
    const item = data.find((v) => v.id === variantId);
    expect(item).toBeDefined();
    expect(item?.stockQuantity).toBe(20);
    expect(item?.lowStockThreshold).toBe(5);
    expect(item?.isLowStock).toBe(false);
    expect(item?.product).toBeDefined();
  });

  it('searches by SKU or product name', async () => {
    const res = await adminGet(`/inventory?q=Inventory+Test`);
    expect(res.status).toBe(200);
    const { data } = res.body as { data: { id: string }[] };
    expect(data.some((v) => v.id === variantId)).toBe(true);
  });

  it('filters by category', async () => {
    const res = await adminGet(`/inventory?categoryId=${categoryId}`);
    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      // All items should belong to products in this category
      expect(item.product).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// Stock adjustment
// ---------------------------------------------------------------------------

describe('admin stock adjustment', () => {
  it('increases stock', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: 10,
      reason: 'ADMIN_ADJUSTMENT',
      note: 'Restock delivery',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.stockQuantity).toBe(30);
  });

  it('decreases stock', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: -5,
      reason: 'DAMAGE',
      note: 'Damaged in warehouse',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.stockQuantity).toBe(25);
  });

  it('rejects zero delta', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: 0,
      reason: 'ADMIN_ADJUSTMENT',
    });

    expect(res.status).toBe(400);
  });

  it('rejects adjustment that would make stock negative', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: -999,
      reason: 'ADMIN_ADJUSTMENT',
    });

    expect(res.status).toBe(400);
  });

  it('rejects non-admin reasons', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: 1,
      reason: 'ORDER_PLACED',
    });

    expect(res.status).toBe(400);
  });

  it('rejects unknown variant', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId: 'nonexistent-variant-id',
      delta: 1,
      reason: 'ADMIN_ADJUSTMENT',
    });

    expect(res.status).toBe(404);
  });

  it('rejects unknown fields', async () => {
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: 1,
      reason: 'ADMIN_ADJUSTMENT',
      secretField: true,
    });

    expect(res.status).toBe(400);
  });

  it('records a movement for every adjustment', async () => {
    const movements = await prisma.inventoryMovement.findMany({
      where: { variantId, reason: { in: ['ADMIN_ADJUSTMENT', 'DAMAGE'] } },
      orderBy: { createdAt: 'asc' },
    });

    expect(movements.length).toBeGreaterThanOrEqual(2);
    // First adjustment was +10, second was -5
    const adjustment = movements.find((m) => m.reason === 'ADMIN_ADJUSTMENT');
    const damage = movements.find((m) => m.reason === 'DAMAGE');
    expect(adjustment).toBeDefined();
    expect(adjustment!.delta).toBe(10);
    expect(damage).toBeDefined();
    expect(damage!.delta).toBe(-5);
  });

  it('records audit entries for adjustments', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityId: variantId, action: 'inventory.stock.adjusted' },
      orderBy: { createdAt: 'asc' },
    });

    expect(audits.length).toBeGreaterThanOrEqual(2);
    for (const audit of audits) {
      expect(audit.actorUserId).toBe(admin.userId);
    }
  });
});

// ---------------------------------------------------------------------------
// Low-stock alert
// ---------------------------------------------------------------------------

describe('low-stock alert', () => {
  it('inserts an outbox event when stock reaches threshold', async () => {
    // Bring stock down to the threshold (currently 25, threshold 5)
    const res = await adminPost('/inventory/adjustments', {
      variantId,
      delta: -20,
      reason: 'ADMIN_ADJUSTMENT',
      note: 'Trigger low stock',
    });
    expect(res.status).toBe(201);
    expect(res.body.data.stockQuantity).toBe(5);

    const alert = await prisma.outboxEvent.findFirst({
      where: { eventType: 'LOW_STOCK_ALERT' },
      orderBy: { createdAt: 'desc' },
    });

    expect(alert).toBeDefined();
    const payload = alert!.payload as Record<string, unknown>;
    expect(payload.variantId).toBe(variantId);
    expect(payload.currentStock).toBe(5);
  });
});

// ---------------------------------------------------------------------------
// Variant stock detail
// ---------------------------------------------------------------------------

describe('variant stock detail', () => {
  it('returns variant with recent movements', async () => {
    const res = await adminGet(`/inventory/${variantId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(variantId);
    expect(res.body.data.stockQuantity).toBeDefined();
    expect(res.body.data.recentMovements).toBeDefined();
    expect(res.body.data.recentMovements.length).toBeGreaterThan(0);
  });

  it('returns 404 for unknown variant', async () => {
    const res = await adminGet('/inventory/nonexistent-variant-id');
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Movement history
// ---------------------------------------------------------------------------

describe('movement history', () => {
  it('lists movements', async () => {
    const res = await adminGet('/inventory/movements');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.total).toBeGreaterThan(0);

    const movement = res.body.data[0];
    expect(movement.delta).toBeDefined();
    expect(movement.resultingQuantity).toBeDefined();
    expect(movement.reason).toBeDefined();
    expect(movement.variant).toBeDefined();
  });

  it('filters movements by variantId', async () => {
    const res = await adminGet(`/inventory/movements?variantId=${variantId}`);
    expect(res.status).toBe(200);
    for (const m of res.body.data) {
      expect(m.variantId).toBe(variantId);
    }
  });

  it('filters movements by reason', async () => {
    const res = await adminGet('/inventory/movements?reason=DAMAGE');
    expect(res.status).toBe(200);
    for (const m of res.body.data) {
      expect(m.reason).toBe('DAMAGE');
    }
  });
});

// ---------------------------------------------------------------------------
// Concurrent stock claim (architecture.md §8)
// ---------------------------------------------------------------------------

describe('concurrent stock claim', () => {
  let freshVariantId: string;

  beforeAll(async () => {
    // Create a product with exactly 1 unit of stock for the race test
    const { variants } = await makeProduct({
      categoryId,
      name: 'Race Test Product',
      variants: [{ color: 'Red', size: 'S', stockQuantity: 1, lowStockThreshold: 0 }],
    });
    freshVariantId = variants[0]!.id;
  });

  it('concurrent final-unit claim never oversells', async () => {
    // Simulate two concurrent adjustments trying to remove the last unit
    const results = await Promise.allSettled([
      adminPost('/inventory/adjustments', {
        variantId: freshVariantId,
        delta: -1,
        reason: 'ADMIN_ADJUSTMENT',
        note: 'Concurrent attempt 1',
      }),
      adminPost('/inventory/adjustments', {
        variantId: freshVariantId,
        delta: -1,
        reason: 'ADMIN_ADJUSTMENT',
        note: 'Concurrent attempt 2',
      }),
    ]);

    const responses = results
      .filter((r) => r.status === 'fulfilled')
      .map((r) => (r as PromiseFulfilledResult<request.Response>).value);

    // One should succeed (201), and the other should fail (400 — negative stock)
    const successes = responses.filter((r) => r.status === 201);
    const failures = responses.filter((r) => r.status === 400);

    expect(successes.length).toBe(1);
    expect(failures.length).toBe(1);

    // Verify stock is exactly 0, never negative
    const variant = await prisma.productVariant.findUnique({
      where: { id: freshVariantId },
      select: { stockQuantity: true },
    });
    expect(variant!.stockQuantity).toBe(0);
  });
});
