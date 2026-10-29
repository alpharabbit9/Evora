/**
 * Repeatable development seed.
 *
 * THE RULE THIS FILE EXISTS TO ENFORCE: a rerun must never overwrite operational data.
 * Price, stock, low-stock threshold, publication status and variant status are written
 * ONLY when a row is created. On a rerun, existing categories and products get their
 * descriptive copy refreshed and nothing else; existing variants are not touched at all
 * (`update: {}`), because every writable field on a variant is operational.
 *
 * So: seed -> adjust stock in the admin UI -> seed again -> the adjustment survives.
 * `tests/db/seed.test.ts` asserts exactly that against a real database.
 *
 * Run with `npm run prisma:seed`, or through `prisma migrate reset`, which calls it via
 * `migrations.seed` in prisma.config.ts.
 */
import { pathToFileURL } from 'node:url';

import type { PrismaClient } from '@prisma/client';

import { env, isProduction } from '../src/config/env.js';
import { auth } from '../src/lib/auth.js';
import { logger } from '../src/lib/logger.js';
import { prisma } from '../src/lib/prisma.js';
import { SEED_CATEGORIES, SEED_PRODUCTS } from './seed-data.js';

export interface Counts {
  created: number;
  existing: number;
}

export interface SeedReport {
  categories: Counts;
  products: Counts;
  variants: Counts;
  admin: 'created' | 'exists' | 'skipped';
  /** Always 0 by construction; reported so a rerun says so out loud. */
  operationalFieldsWrittenOnExistingRows: 0;
}

const tally = (): Counts => ({ created: 0, existing: 0 });

async function seedCategories(db: PrismaClient): Promise<Counts> {
  const counts = tally();

  // Parents first: a child's parentId must already exist.
  const ordered = [
    ...SEED_CATEGORIES.filter((category) => !category.parentSlug),
    ...SEED_CATEGORIES.filter((category) => category.parentSlug),
  ];

  for (const category of ordered) {
    const existing = await db.category.findUnique({ where: { slug: category.slug } });

    if (existing) {
      // Descriptive copy only. `isActive` and `sortOrder` are merchandising decisions an
      // admin may have changed, so a rerun leaves them alone.
      await db.category.update({
        where: { slug: category.slug },
        data: { name: category.name, description: category.description },
      });
      counts.existing += 1;
      continue;
    }

    const parent = category.parentSlug
      ? await db.category.findUniqueOrThrow({ where: { slug: category.parentSlug } })
      : null;

    await db.category.create({
      data: {
        slug: category.slug,
        name: category.name,
        description: category.description,
        sortOrder: category.sortOrder,
        ...(parent ? { parentId: parent.id } : {}),
      },
    });
    counts.created += 1;
  }

  return counts;
}

async function seedProducts(db: PrismaClient): Promise<{ products: Counts; variants: Counts }> {
  const products = tally();
  const variants = tally();

  for (const product of SEED_PRODUCTS) {
    const category = await db.category.findUniqueOrThrow({
      where: { slug: product.categorySlug },
    });

    const existing = await db.product.findUnique({ where: { slug: product.slug } });

    if (existing) {
      // Never re-publish: an admin may have archived this product deliberately, so
      // `status` and `publishedAt` are absent from the update payload.
      await db.product.update({
        where: { slug: product.slug },
        data: {
          name: product.name,
          description: product.description,
          brand: product.brand,
        },
      });
      products.existing += 1;
    } else {
      await db.product.create({
        data: {
          slug: product.slug,
          name: product.name,
          description: product.description,
          brand: product.brand,
          categoryId: category.id,
          status: product.published ? 'PUBLISHED' : 'DRAFT',
          ...(product.published ? { publishedAt: new Date() } : {}),
        },
      });
      products.created += 1;
    }

    const productRow = await db.product.findUniqueOrThrow({ where: { slug: product.slug } });

    for (const variant of product.variants) {
      const before = await db.productVariant.findUnique({ where: { sku: variant.sku } });

      // `update: {}` is the whole point: price, stock, threshold and status are set at
      // creation and never rewritten by a rerun.
      await db.productVariant.upsert({
        where: { sku: variant.sku },
        update: {},
        create: {
          productId: productRow.id,
          sku: variant.sku,
          optionKey: variant.optionKey,
          options: variant.options,
          priceMinor: variant.priceMinor,
          stockQuantity: variant.stockQuantity,
          lowStockThreshold: variant.lowStockThreshold,
          ...(variant.compareAtPriceMinor === undefined
            ? {}
            : { compareAtPriceMinor: variant.compareAtPriceMinor }),
          ...(variant.weightGrams === undefined ? {} : { weightGrams: variant.weightGrams }),
        },
      });

      if (before) variants.existing += 1;
      else variants.created += 1;
    }
  }

  return { products, variants };
}

/**
 * Optional bootstrap account. Better Auth does the password hashing — this never writes
 * Account.password itself — and the role is elevated afterwards because Better Auth marks
 * `role` as `input: false`, so sign-up cannot set it.
 *
 * The seeded account is a SUPERADMIN, not an ADMIN, and that is the whole bootstrap story:
 * granting a role is a SUPERADMIN-only operation (`PATCH /admin/customers/:userId/role`),
 * so if the seed produced an ADMIN there would be no way to create the first one. Every
 * other administrator is promoted from this account, which is also what puts the promotion
 * in the audit log.
 *
 * There is deliberately no default password: without SEED_ADMIN_PASSWORD the step is
 * skipped rather than creating a known-credential superadmin. The value is never logged.
 *
 * `allowCreate` is false for the integration suite, because the `auth` instance is bound to
 * the DATABASE_URL client and would write to the wrong database.
 */
async function seedAdmin(db: PrismaClient, allowCreate: boolean): Promise<SeedReport['admin']> {
  const email = (process.env.SEED_ADMIN_EMAIL ?? 'admin@commercecore.test').toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  const existing = await db.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'SUPERADMIN') {
      await db.user.update({ where: { email }, data: { role: 'SUPERADMIN' } });
    }
    return 'exists';
  }

  if (!password || !allowCreate) return 'skipped';

  await auth.api.signUpEmail({
    body: { email, password, name: process.env.SEED_ADMIN_NAME ?? 'CommerceCore Admin' },
  });
  // `emailVerified` is set here because email delivery is not implemented yet (PRD §9);
  // the bootstrap account must not be stuck behind a verification link nobody can send.
  await db.user.update({ where: { email }, data: { role: 'SUPERADMIN', emailVerified: true } });

  return 'created';
}

export async function runSeed(
  db: PrismaClient,
  options: { allowAdminCreate?: boolean } = {},
): Promise<SeedReport> {
  const categories = await seedCategories(db);
  const { products, variants } = await seedProducts(db);
  const admin = await seedAdmin(db, options.allowAdminCreate ?? false);

  return {
    categories,
    products,
    variants,
    admin,
    operationalFieldsWrittenOnExistingRows: 0,
  };
}

async function main(): Promise<void> {
  if (isProduction && process.env.SEED_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Refusing to seed with NODE_ENV=production. Set SEED_ALLOW_PRODUCTION=true only if that is genuinely intended.',
    );
  }

  const report = await runSeed(prisma, { allowAdminCreate: true });
  logger.info({ environment: env.NODE_ENV, ...report }, 'Seed complete');

  if (report.admin === 'skipped') {
    logger.warn(
      'Bootstrap superadmin not seeded: set SEED_ADMIN_PASSWORD to create one. No default password is used.',
    );
  }
}

// Only the CLI entry point runs the seed; importing this module (the tests do) must not.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    await main();
  } catch (error) {
    logger.error({ err: error }, 'Seed failed');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
