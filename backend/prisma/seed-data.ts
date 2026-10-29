/**
 * Deterministic development fixture for `prisma/seed.ts`.
 *
 * Small on purpose: this exists so a fresh clone has a navigable catalog, not so it looks
 * like a populated store. The fashion catalog import (PRD FR-08, docs/fashion-catalog-setup.md) is
 * the separate M3 script `scripts/catalog-import/`
 * with its own rerun rules — do not grow this file into it.
 *
 * No ProductImage rows: image binaries live in object storage, which arrives in M3. Seeding
 * metadata that points at objects nobody uploaded would be a placeholder presented as real.
 *
 * Money is in MINOR UNITS of the single store currency (see ADR 0008).
 */

export interface SeedCategory {
  slug: string;
  name: string;
  description: string;
  parentSlug?: string;
  sortOrder: number;
}

export interface SeedVariant {
  sku: string;
  optionKey: string;
  options: Record<string, string>;
  priceMinor: number;
  compareAtPriceMinor?: number;
  stockQuantity: number;
  lowStockThreshold: number;
  weightGrams?: number;
}

export interface SeedProduct {
  slug: string;
  name: string;
  description: string;
  brand: string;
  categorySlug: string;
  /** Seeded products are published so the storefront has something to list. */
  published: boolean;
  variants: SeedVariant[];
}

export const SEED_CATEGORIES: SeedCategory[] = [
  { slug: 'apparel', name: 'Apparel', description: 'Everyday clothing.', sortOrder: 1 },
  {
    slug: 't-shirts',
    name: 'T-Shirts',
    description: 'Short-sleeve tops.',
    parentSlug: 'apparel',
    sortOrder: 1,
  },
  {
    slug: 'accessories',
    name: 'Accessories',
    description: 'Bags, bottles and small goods.',
    sortOrder: 2,
  },
  { slug: 'audio', name: 'Audio', description: 'Headphones and speakers.', sortOrder: 3 },
];

export const SEED_PRODUCTS: SeedProduct[] = [
  {
    slug: 'core-cotton-tee',
    name: 'Core Cotton Tee',
    description: 'A mid-weight combed cotton t-shirt with a set-in collar.',
    brand: 'CommerceCore Basics',
    categorySlug: 't-shirts',
    published: true,
    variants: [
      {
        sku: 'CCT-BLK-S',
        optionKey: 'color:black|size:s',
        options: { color: 'Black', size: 'S' },
        priceMinor: 2400,
        stockQuantity: 25,
        lowStockThreshold: 5,
        weightGrams: 180,
      },
      {
        sku: 'CCT-BLK-M',
        optionKey: 'color:black|size:m',
        options: { color: 'Black', size: 'M' },
        priceMinor: 2400,
        stockQuantity: 40,
        lowStockThreshold: 5,
        weightGrams: 190,
      },
      {
        sku: 'CCT-WHT-M',
        optionKey: 'color:white|size:m',
        options: { color: 'White', size: 'M' },
        priceMinor: 2400,
        stockQuantity: 12,
        lowStockThreshold: 5,
        weightGrams: 190,
      },
    ],
  },
  {
    slug: 'heavyweight-pocket-tee',
    name: 'Heavyweight Pocket Tee',
    description: 'Heavier knit with a reinforced chest pocket.',
    brand: 'CommerceCore Basics',
    categorySlug: 't-shirts',
    published: true,
    variants: [
      {
        sku: 'HPT-NVY-M',
        optionKey: 'color:navy|size:m',
        options: { color: 'Navy', size: 'M' },
        priceMinor: 3200,
        compareAtPriceMinor: 3800,
        stockQuantity: 18,
        lowStockThreshold: 4,
        weightGrams: 260,
      },
      {
        sku: 'HPT-NVY-L',
        optionKey: 'color:navy|size:l',
        options: { color: 'Navy', size: 'L' },
        priceMinor: 3200,
        compareAtPriceMinor: 3800,
        stockQuantity: 3,
        lowStockThreshold: 4,
        weightGrams: 275,
      },
    ],
  },
  {
    slug: 'canvas-day-tote',
    name: 'Canvas Day Tote',
    description: 'Waxed canvas tote with an internal laptop sleeve.',
    brand: 'Fieldline',
    categorySlug: 'accessories',
    published: true,
    variants: [
      {
        sku: 'CDT-SND-OS',
        optionKey: 'default',
        options: {},
        priceMinor: 5900,
        stockQuantity: 14,
        lowStockThreshold: 3,
        weightGrams: 640,
      },
    ],
  },
  {
    slug: 'insulated-steel-bottle',
    name: 'Insulated Steel Bottle',
    description: 'Vacuum-insulated 750 ml bottle with a leakproof cap.',
    brand: 'Fieldline',
    categorySlug: 'accessories',
    published: true,
    variants: [
      {
        sku: 'ISB-750-STL',
        optionKey: 'finish:steel',
        options: { finish: 'Brushed steel' },
        priceMinor: 3400,
        stockQuantity: 30,
        lowStockThreshold: 6,
        weightGrams: 410,
      },
      {
        sku: 'ISB-750-MAT',
        optionKey: 'finish:matte',
        options: { finish: 'Matte black' },
        priceMinor: 3600,
        stockQuantity: 0,
        lowStockThreshold: 6,
        weightGrams: 410,
      },
    ],
  },
  {
    slug: 'studio-over-ear-headphones',
    name: 'Studio Over-Ear Headphones',
    description: 'Closed-back monitoring headphones with a detachable cable.',
    brand: 'Northtone',
    categorySlug: 'audio',
    published: true,
    variants: [
      {
        sku: 'SOE-BLK',
        optionKey: 'color:black',
        options: { color: 'Black' },
        priceMinor: 18900,
        stockQuantity: 8,
        lowStockThreshold: 2,
        weightGrams: 320,
      },
    ],
  },
  {
    slug: 'desk-bluetooth-speaker',
    name: 'Desk Bluetooth Speaker',
    description:
      'Compact desktop speaker; a draft product, useful for checking that unpublished items stay private.',
    brand: 'Northtone',
    categorySlug: 'audio',
    published: false,
    variants: [
      {
        sku: 'DBS-GRY',
        optionKey: 'color:grey',
        options: { color: 'Grey' },
        priceMinor: 7400,
        stockQuantity: 5,
        lowStockThreshold: 2,
        weightGrams: 520,
      },
    ],
  },
];
