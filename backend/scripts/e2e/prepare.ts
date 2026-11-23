/**
 * Resets the end-to-end database and writes the fixture the Playwright suite (`../e2e`) drives.
 *
 * Run by `e2e/global-setup.ts` after `prisma migrate deploy`, with DATABASE_URL already pointed
 * at the E2E database. Never run it by hand against anything else: it truncates every table.
 *
 * The fixture is deliberately small and fixed, so a spec can name exactly what it expects:
 *   - one active category and one published product, `E2E_PRODUCT` below, with three sizes —
 *     M and L in stock, S sold out (so the sold-out state is on screen, not just in a test);
 *   - one photo, copied into MEDIA_ROOT so `next/image` has a real file to optimise;
 *   - one superadmin, created through Better Auth exactly as `prisma/seed.ts` does.
 *
 * Customers are NOT created here: the suite registers them through the real sign-up page.
 */
import { copyFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { env } from '../../src/config/env.js';
import { auth } from '../../src/lib/auth.js';
import { logger } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';

/** Mirrored in `e2e/fixtures.ts`; change both together. */
export const E2E_PRODUCT = {
  categorySlug: 'e2e-outerwear',
  categoryName: 'E2E Outerwear',
  slug: 'e2e-field-jacket',
  name: 'E2E Field Jacket',
  priceMinor: 450_000,
  sizes: [
    { size: 'S', stock: 0 },
    { size: 'M', stock: 5 },
    { size: 'L', stock: 5 },
  ],
} as const;

const here = path.dirname(fileURLToPath(import.meta.url));
const SAMPLE_IMAGE = path.resolve(
  here,
  '../../../frontend/public/images/homepage/reviews/man-in-coat-at-shop-window.jpg',
);
const OBJECT_KEY = 'catalog/e2e/field-jacket/1.jpg';

function refuseUnlessE2eDatabase(): void {
  const name = new URL(env.DATABASE_URL).pathname.replace(/^\//, '');

  if (!/e2e/i.test(name)) {
    throw new Error(
      `Refusing to reset "${name}": the E2E fixture truncates every table, so DATABASE_URL ` +
        'must name a database containing "e2e".',
    );
  }

  if (env.NODE_ENV === 'production') {
    throw new Error('Refusing to reset a database with NODE_ENV=production.');
  }
}

async function truncateAll(): Promise<void> {
  const rows = await prisma.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'
  `;

  if (rows.length === 0) {
    throw new Error('The E2E database has no tables; run `prisma migrate deploy` first.');
  }

  const list = rows.map((row) => `"public"."${row.tablename}"`).join(', ');
  await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
}

async function seedCatalog(): Promise<void> {
  const category = await prisma.category.create({
    data: { slug: E2E_PRODUCT.categorySlug, name: E2E_PRODUCT.categoryName },
  });

  const product = await prisma.product.create({
    data: {
      slug: E2E_PRODUCT.slug,
      name: E2E_PRODUCT.name,
      brand: 'EVORA',
      description: 'A waxed-cotton field jacket used by the end-to-end suite.',
      categoryId: category.id,
      gender: 'MEN',
      status: 'PUBLISHED',
      publishedAt: new Date(Date.now() - 60_000),
      featuredRank: 1,
    },
  });

  for (const variant of E2E_PRODUCT.sizes) {
    await prisma.productVariant.create({
      data: {
        productId: product.id,
        sku: `E2E-FJ-${variant.size}`,
        optionKey: `color:olive|size:${variant.size.toLowerCase()}`,
        options: { color: 'Olive', size: variant.size },
        priceMinor: E2E_PRODUCT.priceMinor,
        priceSource: 'SYNTHETIC',
        stockQuantity: variant.stock,
        lowStockThreshold: 1,
        status: 'ACTIVE',
      },
    });
  }

  const target = path.resolve(env.MEDIA_ROOT, ...OBJECT_KEY.split('/'));
  await mkdir(path.dirname(target), { recursive: true });
  await copyFile(SAMPLE_IMAGE, target);

  await prisma.productImage.create({
    data: {
      productId: product.id,
      objectKey: OBJECT_KEY,
      altText: E2E_PRODUCT.name,
      sortOrder: 0,
      widthPx: 1200,
      heightPx: 1500,
      byteSize: 1000,
      contentType: 'image/jpeg',
    },
  });
}

async function seedAdmin(): Promise<void> {
  const email = process.env.E2E_ADMIN_EMAIL;
  const password = process.env.E2E_ADMIN_PASSWORD;

  if (!email || !password) {
    throw new Error('E2E_ADMIN_EMAIL and E2E_ADMIN_PASSWORD must be set (see e2e/fixtures.ts).');
  }

  await auth.api.signUpEmail({ body: { email, password, name: 'E2E Superadmin' } });
  await prisma.user.update({
    where: { email: email.toLowerCase() },
    data: { role: 'SUPERADMIN', emailVerified: true },
  });
}

async function main(): Promise<void> {
  refuseUnlessE2eDatabase();
  await truncateAll();
  await seedCatalog();
  await seedAdmin();
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (error: unknown) => {
    logger.error({ err: error }, 'E2E fixture failed');
    await prisma.$disconnect();
    process.exit(1);
  });
