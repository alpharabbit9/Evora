import { CouponType } from '@prisma/client';
import { z } from 'zod';

import { opaqueId, paginationQuery } from '../../http/schemas.js';
import { MAX_MONEY_MINOR } from '../pricing/pricing.js';

/**
 * Coupon request shapes (API_SPEC.md §8, ADR 0022). Codes are stored upper-case
 * (`coupons_code_uppercase_check`), so what a person types is normalised before it is checked.
 */
export const couponCode = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9_-]{2,31}$/, 'Use 3–32 letters, digits, - or _');

const money = z.number().int().min(1).max(MAX_MONEY_MINOR);
const instant = z.iso.datetime({ offset: true }).transform((value) => new Date(value));

const productIds = z.array(opaqueId).max(200);

const shared = {
  minimumSpendMinor: money.nullable().default(null),
  maxDiscountMinor: money.nullable().default(null),
  startsAt: instant.nullable().default(null),
  endsAt: instant.nullable().default(null),
  usageLimit: z.number().int().min(1).max(10_000_000).nullable().default(null),
  perUserLimit: z.number().int().min(1).max(1000).nullable().default(null),
  isActive: z.boolean().default(true),
  appliesToAllProducts: z.boolean().default(true),
  productIds: productIds.default([]),
};

function windowIsOrdered(value: { startsAt?: Date | null; endsAt?: Date | null }) {
  return !value.startsAt || !value.endsAt || value.endsAt > value.startsAt;
}

function productsWhenRestricted(value: {
  appliesToAllProducts?: boolean;
  productIds?: readonly string[];
}) {
  return value.appliesToAllProducts !== false || (value.productIds?.length ?? 0) > 0;
}

export const adminCouponCreateBody = z
  .discriminatedUnion('type', [
    z.strictObject({
      code: couponCode,
      type: z.literal(CouponType.PERCENT),
      /** 1–100 %, in basis points (1000 = 10 %). */
      percentBps: z.number().int().min(1).max(10_000),
      ...shared,
    }),
    z.strictObject({
      code: couponCode,
      type: z.literal(CouponType.FIXED),
      valueMinor: money,
      ...shared,
    }),
  ])
  .refine(windowIsOrdered, { path: ['endsAt'], message: 'Must be after the start' })
  .refine(productsWhenRestricted, {
    path: ['productIds'],
    message: 'Choose at least one product, or let it apply to all products',
  });

export type AdminCouponCreateInput = z.output<typeof adminCouponCreateBody>;

/**
 * Everything but the code and the type can change. A change never touches an order already
 * placed: each keeps its own discount and the code it used.
 */
export const adminCouponUpdateBody = z
  .strictObject({
    percentBps: z.number().int().min(1).max(10_000).optional(),
    valueMinor: money.optional(),
    minimumSpendMinor: money.nullable().optional(),
    maxDiscountMinor: money.nullable().optional(),
    startsAt: instant.nullable().optional(),
    endsAt: instant.nullable().optional(),
    usageLimit: z.number().int().min(1).max(10_000_000).nullable().optional(),
    perUserLimit: z.number().int().min(1).max(1000).nullable().optional(),
    isActive: z.boolean().optional(),
    appliesToAllProducts: z.boolean().optional(),
    productIds: productIds.optional(),
  })
  .refine((value) => Object.keys(value).length > 0, 'Nothing to change');

export type AdminCouponUpdateInput = z.output<typeof adminCouponUpdateBody>;

export const adminCouponListQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(40).optional(),
  state: z.enum(['active', 'scheduled', 'expired', 'inactive', 'used_up']).optional(),
});
