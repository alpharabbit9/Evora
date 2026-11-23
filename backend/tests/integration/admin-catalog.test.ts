import { UserRole } from '@prisma/client';
import request from 'supertest';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { prisma } from '../../src/lib/prisma.js';
import { makeCategory } from './catalog-fixtures.js';
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
let childCategoryId: string;

beforeAll(async () => {
  await truncateAll();
  admin = await signUpAs(app, UserRole.ADMIN);
  customer = await signUp(app);

  const parent = await makeCategory('footwear', { name: 'Footwear' });
  categoryId = parent.id;
  const child = await makeCategory('boots', { parentId: parent.id, name: 'Boots' });
  childCategoryId = child.id;
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

function adminPatch(path: string, body: object, session = admin) {
  return request(app)
    .patch(`${ADMIN}${path}`)
    .set('origin', ORIGIN)
    .set('cookie', session.cookie)
    .send(body);
}

function adminDelete(path: string, session = admin) {
  return request(app).delete(`${ADMIN}${path}`).set('origin', ORIGIN).set('cookie', session.cookie);
}

// ---------------------------------------------------------------------------
// Authorization
// ---------------------------------------------------------------------------

describe('authorization', () => {
  it('rejects unauthenticated requests', async () => {
    const res = await request(app).get(`${ADMIN}/products`);
    expect(res.status).toBe(401);
  });

  it('rejects customers', async () => {
    const res = await adminGet('/products', customer);
    expect(res.status).toBe(403);
  });

  it('allows admin', async () => {
    const res = await adminGet('/products');
    expect(res.status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Products
// ---------------------------------------------------------------------------

describe('admin product CRUD', () => {
  let productId: string;

  it('creates a product', async () => {
    const res = await adminPost('/products', {
      name: 'Admin Test Shoe',
      categoryId,
      brand: 'TestBrand',
      gender: 'MEN',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Admin Test Shoe');
    expect(res.body.data.status).toBe('DRAFT');
    expect(res.body.data.slug).toMatch(/^admin-test-shoe-/);
    expect(res.body.data.category.id).toBe(categoryId);
    productId = res.body.data.id;
  });

  it('creates a product with a custom slug', async () => {
    const res = await adminPost('/products', {
      name: 'Custom Slug Product',
      slug: 'my-custom-slug',
      categoryId,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.slug).toBe('my-custom-slug');
  });

  it('rejects invalid categoryId', async () => {
    const res = await adminPost('/products', {
      name: 'Bad Category',
      categoryId: 'nonexistent-category-id',
    });

    expect(res.status).toBe(400);
  });

  it('lists products', async () => {
    const res = await adminGet('/products');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
    expect(res.body.meta.total).toBeGreaterThan(0);
  });

  it('lists products filtered by status', async () => {
    const res = await adminGet('/products?status=DRAFT');
    expect(res.status).toBe(200);
    for (const item of res.body.data) {
      expect(item.status).toBe('DRAFT');
    }
  });

  it('searches products by name', async () => {
    const res = await adminGet('/products?q=Admin+Test');
    expect(res.status).toBe(200);
    const { data } = res.body as { data: { name: string }[] };
    expect(data.some((p) => p.name === 'Admin Test Shoe')).toBe(true);
  });

  it('gets a product by id', async () => {
    const res = await adminGet(`/products/${productId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(productId);
    expect(res.body.data.name).toBe('Admin Test Shoe');
    expect(res.body.data.variants).toBeDefined();
    expect(res.body.data.images).toBeDefined();
  });

  it('returns 404 for unknown product', async () => {
    const res = await adminGet('/products/nonexistent-product-id');
    expect(res.status).toBe(404);
  });

  it('updates a product', async () => {
    const res = await adminPatch(`/products/${productId}`, {
      name: 'Updated Shoe',
      brand: 'NewBrand',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Updated Shoe');
    expect(res.body.data.brand).toBe('NewBrand');
  });

  it('publishes a product', async () => {
    const res = await adminPatch(`/products/${productId}`, {
      status: 'PUBLISHED',
    });

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('PUBLISHED');
    expect(res.body.data.publishedAt).toBeTruthy();
  });

  it('rejects unknown fields on update', async () => {
    const res = await adminPatch(`/products/${productId}`, {
      name: 'Fine',
      emailVerified: true,
    });
    expect(res.status).toBe(400);
  });

  it('archives a product', async () => {
    const res = await adminPost(`/products/${productId}/archive`, {});

    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ARCHIVED');
  });

  it('archive is idempotent', async () => {
    const res = await adminPost(`/products/${productId}/archive`, {});
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe('ARCHIVED');
  });

  it('records audit entries for product operations', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityId: productId, entityType: 'Product' },
      orderBy: { createdAt: 'asc' },
    });

    const actions = audits.map((a) => a.action);
    expect(actions).toContain('product.created');
    expect(actions).toContain('product.updated');
    expect(actions).toContain('product.archived');
    for (const audit of audits) {
      expect(audit.actorUserId).toBe(admin.userId);
    }
  });
});

// ---------------------------------------------------------------------------
// Variants
// ---------------------------------------------------------------------------

describe('admin variant CRUD', () => {
  let productId: string;
  let variantId: string;

  beforeAll(async () => {
    const res = await adminPost('/products', {
      name: 'Variant Test Product',
      categoryId,
    });
    productId = res.body.data.id;
  });

  it('creates a variant', async () => {
    const res = await adminPost(`/products/${productId}/variants`, {
      sku: 'VTP-BLK-M',
      options: { color: 'Black', size: 'M' },
      priceMinor: 350000,
      stockQuantity: 20,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.sku).toBe('VTP-BLK-M');
    expect(res.body.data.priceMinor).toBe(350000);
    expect(res.body.data.stockQuantity).toBe(20);
    variantId = res.body.data.id;
  });

  it('rejects duplicate option combination', async () => {
    const res = await adminPost(`/products/${productId}/variants`, {
      sku: 'VTP-BLK-M-2',
      options: { color: 'Black', size: 'M' },
      priceMinor: 350000,
    });

    expect(res.status).toBe(409);
  });

  it('rejects duplicate SKU', async () => {
    const res = await adminPost(`/products/${productId}/variants`, {
      sku: 'VTP-BLK-M',
      options: { color: 'Red', size: 'L' },
      priceMinor: 350000,
    });

    expect(res.status).toBe(409);
  });

  it('updates a variant', async () => {
    const res = await adminPatch(`/products/${productId}/variants/${variantId}`, {
      priceMinor: 400000,
      stockQuantity: 15,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.priceMinor).toBe(400000);
    expect(res.body.data.stockQuantity).toBe(15);
  });

  it('returns 404 for variant on wrong product', async () => {
    const other = await adminPost('/products', { name: 'Other Product', categoryId });
    const res = await adminPatch(`/products/${other.body.data.id}/variants/${variantId}`, {
      priceMinor: 100000,
    });
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Images
// ---------------------------------------------------------------------------

describe('admin image CRUD', () => {
  let productId: string;
  let imageId: string;

  beforeAll(async () => {
    const res = await adminPost('/products', {
      name: 'Image Test Product',
      categoryId,
    });
    productId = res.body.data.id;
  });

  it('creates an image', async () => {
    const res = await adminPost(`/products/${productId}/images`, {
      objectKey: 'catalog/test/img-test/1.jpg',
      altText: 'Test product photo',
      sortOrder: 0,
      kind: 'PHOTO',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.altText).toBe('Test product photo');
    expect(res.body.data.url).toBeTruthy();
    imageId = res.body.data.id;
  });

  it('rejects invalid object key', async () => {
    const res = await adminPost(`/products/${productId}/images`, {
      objectKey: '../../../etc/passwd',
      altText: 'Bad key',
    });
    expect(res.status).toBe(500);
  });

  it('updates an image', async () => {
    const res = await adminPatch(`/products/${productId}/images/${imageId}`, {
      altText: 'Updated alt text',
      sortOrder: 5,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.altText).toBe('Updated alt text');
    expect(res.body.data.sortOrder).toBe(5);
  });

  it('deletes an image', async () => {
    const res = await adminDelete(`/products/${productId}/images/${imageId}`);
    expect(res.status).toBe(204);

    const check = await prisma.productImage.findUnique({ where: { id: imageId } });
    expect(check).toBeNull();
  });

  it('returns 404 deleting a missing image', async () => {
    const res = await adminDelete(`/products/${productId}/images/${imageId}`);
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
// Categories
// ---------------------------------------------------------------------------

describe('admin category CRUD', () => {
  let newCategoryId: string;

  it('lists categories (including inactive)', async () => {
    const res = await adminGet('/categories');
    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeGreaterThan(0);
  });

  it('creates a category', async () => {
    const res = await adminPost('/categories', {
      name: 'Accessories',
      slug: 'accessories',
    });

    expect(res.status).toBe(201);
    expect(res.body.data.name).toBe('Accessories');
    expect(res.body.data.slug).toBe('accessories');
    newCategoryId = res.body.data.id;
  });

  it('rejects duplicate slug', async () => {
    const res = await adminPost('/categories', {
      name: 'Another Accessories',
      slug: 'accessories',
    });
    expect(res.status).toBe(409);
  });

  it('creates a child category', async () => {
    const res = await adminPost('/categories', {
      name: 'Bags',
      slug: 'bags',
      parentId: newCategoryId,
    });

    expect(res.status).toBe(201);
    expect(res.body.data.parentId).toBe(newCategoryId);
  });

  it('rejects three-level nesting', async () => {
    const res = await adminPost('/categories', {
      name: 'Deep',
      slug: 'deep-nested',
      parentId: childCategoryId,
    });
    expect(res.status).toBe(400);
  });

  it('gets a category by id', async () => {
    const res = await adminGet(`/categories/${newCategoryId}`);
    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Accessories');
  });

  it('updates a category', async () => {
    const res = await adminPatch(`/categories/${newCategoryId}`, {
      name: 'Accessories & More',
      isActive: false,
    });

    expect(res.status).toBe(200);
    expect(res.body.data.name).toBe('Accessories & More');
    expect(res.body.data.isActive).toBe(false);
  });

  it('rejects self-referencing parent', async () => {
    const res = await adminPatch(`/categories/${newCategoryId}`, {
      parentId: newCategoryId,
    });
    expect(res.status).toBe(400);
  });

  it('records audit entries for category operations', async () => {
    const audits = await prisma.auditLog.findMany({
      where: { entityId: newCategoryId, entityType: 'Category' },
      orderBy: { createdAt: 'asc' },
    });

    const actions = audits.map((a) => a.action);
    expect(actions).toContain('category.created');
    expect(actions).toContain('category.updated');
  });
});
