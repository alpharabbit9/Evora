import type { CouponType, Prisma } from '@prisma/client';

import { env } from '../../config/env.js';
import { conflict, couponInvalid, notFound, validationFailed } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import {
  COUPON_REFUSAL_MESSAGE,
  type CouponLine,
  type CouponTerms,
  evaluateCoupon,
  normaliseCouponCode,
} from '../pricing/coupons.js';
import type { AdminCouponCreateInput, AdminCouponUpdateInput } from './coupons.schemas.js';

/**
 * Coupons (M10, ADR 0022): the admin's catalogue of codes, and the three things checkout and order
 * handling do with one.
 *
 *  - Quote: is the code good for this basket, and what does it take off? Advisory, no lock.
 *  - Redeem, inside the order's transaction, after the stock claim: lock the coupon row, check it
 *    again, then count the use with a conditional update. The lock is what makes a per-customer
 *    limit hold under concurrent checkouts; the conditional update and
 *    `coupons_used_within_limit_check` are the backstops for the global one.
 *  - Release, when the order closes (cancelled, payment failed): the use is given back.
 *
 * Lock order is always product variants, then the coupon (checkout claims stock first; closing an
 * order releases stock first), so the two paths cannot deadlock on each other.
 *
 * The coupon is locked `FOR NO KEY UPDATE`, never `FOR UPDATE`. Inserting an order or a redemption
 * that references a coupon takes `FOR KEY SHARE` on it, before the stock claim. `FOR UPDATE`
 * conflicts with that, so two checkouts would each hold a key-share the other's coupon lock waits
 * for, while one waits on the other's variant: a deadlock (found by the concurrent-checkout test).
 * `FOR NO KEY UPDATE` still serialises redemptions with each other, and does not conflict with it.
 */

const TERMS_SELECT = {
  id: true,
  code: true,
  type: true,
  percentBps: true,
  valueMinor: true,
  currency: true,
  minimumSpendMinor: true,
  maxDiscountMinor: true,
  startsAt: true,
  endsAt: true,
  isActive: true,
  appliesToAllProducts: true,
  usageLimit: true,
  perUserLimit: true,
  usedCount: true,
  products: { select: { productId: true } },
} satisfies Prisma.CouponSelect;

type TermsRow = Prisma.CouponGetPayload<{ select: typeof TERMS_SELECT }>;

function termsOf(row: TermsRow): CouponTerms {
  return { ...row, productIds: row.products.map((product) => product.productId) };
}

async function liveUsesBy(
  db: TransactionClient | typeof prisma,
  couponId: string,
  userId: string,
): Promise<number> {
  return db.couponRedemption.count({ where: { couponId, userId, releasedAt: null } });
}

export interface CouponQuote {
  readonly code: string;
  readonly status: 'applied' | 'refused';
  readonly discountMinor: number;
  /** Why it was refused, in words for the customer. */
  readonly message: string | null;
}

function refused(code: string, message: string): CouponQuote {
  return { code, status: 'refused', discountMinor: 0, message };
}

/** For the checkout quote: a refused code is a status, not an error, like an unavailable line. */
export async function quoteCoupon(
  rawCode: string,
  lines: readonly CouponLine[],
  userId: string,
  now: Date = new Date(),
): Promise<CouponQuote> {
  const code = normaliseCouponCode(rawCode);
  const row = await prisma.coupon.findUnique({ where: { code }, select: TERMS_SELECT });

  if (!row) return refused(code, COUPON_REFUSAL_MESSAGE.UNKNOWN);

  const outcome = evaluateCoupon(termsOf(row), lines, { now, currency: env.STORE_CURRENCY });
  if (!outcome.ok) return refused(code, COUPON_REFUSAL_MESSAGE[outcome.reason]);

  if (
    (row.usageLimit !== null && row.usedCount >= row.usageLimit) ||
    (row.perUserLimit !== null && (await liveUsesBy(prisma, row.id, userId)) >= row.perUserLimit)
  ) {
    return refused(code, COUPON_REFUSAL_MESSAGE.USED_UP);
  }

  return { code, status: 'applied', discountMinor: outcome.discountMinor, message: null };
}

export interface CouponPrice {
  readonly couponId: string;
  readonly code: string;
  readonly discountMinor: number;
}

/**
 * The discount an order is priced with, read inside its transaction but without a lock (the
 * stock claim comes first). Throws `COUPON_INVALID` with the customer's reason.
 */
export async function priceCoupon(
  tx: TransactionClient,
  rawCode: string,
  lines: readonly CouponLine[],
  now: Date,
): Promise<CouponPrice> {
  const code = normaliseCouponCode(rawCode);
  const row = await tx.coupon.findUnique({ where: { code }, select: TERMS_SELECT });

  if (!row) throw couponInvalid(COUPON_REFUSAL_MESSAGE.UNKNOWN);

  const outcome = evaluateCoupon(termsOf(row), lines, { now, currency: env.STORE_CURRENCY });
  if (!outcome.ok) throw couponInvalid(COUPON_REFUSAL_MESSAGE[outcome.reason]);

  return { couponId: row.id, code: row.code, discountMinor: outcome.discountMinor };
}

/**
 * Counts the use, after the stock claim and under the coupon's row lock. The coupon is evaluated
 * again under the lock: if it changed, or its limits were reached by another order in between, the
 * whole order rolls back with the reason, rather than committing a discount it no longer earns.
 */
export async function redeemCoupon(
  tx: TransactionClient,
  priced: CouponPrice,
  context: {
    readonly orderId: string;
    readonly userId: string;
    readonly lines: readonly CouponLine[];
    readonly now: Date;
  },
): Promise<void> {
  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${priced.couponId} FOR NO KEY UPDATE`;

  const row = await tx.coupon.findUniqueOrThrow({
    where: { id: priced.couponId },
    select: TERMS_SELECT,
  });
  const outcome = evaluateCoupon(termsOf(row), context.lines, {
    now: context.now,
    currency: env.STORE_CURRENCY,
  });

  if (!outcome.ok) throw couponInvalid(COUPON_REFUSAL_MESSAGE[outcome.reason]);
  if (outcome.discountMinor !== priced.discountMinor) {
    throw conflict('The total for your order has changed. Please review it and try again.', {
      details: [{ field: 'couponCode', issue: 'The coupon changed while the order was placed' }],
    });
  }

  if (
    row.perUserLimit !== null &&
    (await liveUsesBy(tx, row.id, context.userId)) >= row.perUserLimit
  ) {
    throw couponInvalid(COUPON_REFUSAL_MESSAGE.USED_UP);
  }

  const claimed = await tx.$executeRaw`
    UPDATE coupons
    SET used_count = used_count + 1, updated_at = NOW()
    WHERE id = ${row.id} AND (usage_limit IS NULL OR used_count < usage_limit)
  `;

  if (claimed === 0) throw couponInvalid(COUPON_REFUSAL_MESSAGE.USED_UP);

  await tx.couponRedemption.create({
    data: {
      couponId: row.id,
      orderId: context.orderId,
      userId: context.userId,
      discountMinor: priced.discountMinor,
    },
  });
}

/**
 * The order closed before it was fulfilled: its use is given back. Idempotent: a redemption that
 * was already released is left alone. Call after releasing stock (lock order).
 */
export async function releaseCoupon(tx: TransactionClient, orderId: string): Promise<void> {
  const redemption = await tx.couponRedemption.findFirst({
    where: { orderId, releasedAt: null },
    select: { id: true, couponId: true },
  });

  if (!redemption) return;

  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${redemption.couponId} FOR NO KEY UPDATE`;
  await tx.couponRedemption.update({
    where: { id: redemption.id },
    data: { releasedAt: new Date() },
  });
  await tx.$executeRaw`
    UPDATE coupons SET used_count = used_count - 1, updated_at = NOW()
    WHERE id = ${redemption.couponId} AND used_count > 0
  `;
}

/**
 * Money arrived for an order that had closed and its goods were still there, so it is confirmed
 * again (ADR 0019). Its coupon use counts again if the coupon still has one to give. If not, the
 * order keeps the discount it was paid at (the customer has paid that amount) and stays released.
 */
export async function reclaimCoupon(tx: TransactionClient, orderId: string): Promise<void> {
  const redemption = await tx.couponRedemption.findFirst({
    where: { orderId, releasedAt: { not: null } },
    select: { id: true, couponId: true },
  });

  if (!redemption) return;

  await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${redemption.couponId} FOR NO KEY UPDATE`;
  const claimed = await tx.$executeRaw`
    UPDATE coupons SET used_count = used_count + 1, updated_at = NOW()
    WHERE id = ${redemption.couponId} AND (usage_limit IS NULL OR used_count < usage_limit)
  `;

  if (claimed === 0) {
    logger.warn({ orderId }, 'A reconfirmed order keeps its discount past its coupon limit');
    return;
  }

  await tx.couponRedemption.update({ where: { id: redemption.id }, data: { releasedAt: null } });
}

// ---------------------------------------------------------------------------
// Administration
// ---------------------------------------------------------------------------

export type CouponState = 'active' | 'scheduled' | 'expired' | 'inactive' | 'used_up';

export interface CouponView {
  readonly id: string;
  readonly code: string;
  readonly type: CouponType;
  readonly percentBps: number | null;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly minimumSpendMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly usageLimit: number | null;
  readonly perUserLimit: number | null;
  readonly usedCount: number;
  readonly isActive: boolean;
  readonly appliesToAllProducts: boolean;
  readonly products: readonly {
    readonly id: string;
    readonly name: string;
    readonly slug: string;
  }[];
  readonly state: CouponState;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

const VIEW_SELECT = {
  id: true,
  code: true,
  type: true,
  percentBps: true,
  valueMinor: true,
  currency: true,
  minimumSpendMinor: true,
  maxDiscountMinor: true,
  startsAt: true,
  endsAt: true,
  usageLimit: true,
  perUserLimit: true,
  usedCount: true,
  isActive: true,
  appliesToAllProducts: true,
  createdAt: true,
  updatedAt: true,
  products: {
    select: { product: { select: { id: true, name: true, slug: true } } },
    orderBy: { product: { name: 'asc' } },
  },
} satisfies Prisma.CouponSelect;

type ViewRow = Prisma.CouponGetPayload<{ select: typeof VIEW_SELECT }>;

export function couponState(
  row: Pick<ViewRow, 'isActive' | 'startsAt' | 'endsAt' | 'usageLimit' | 'usedCount'>,
  now: Date = new Date(),
): CouponState {
  if (!row.isActive) return 'inactive';
  if (row.endsAt && now >= row.endsAt) return 'expired';
  if (row.usageLimit !== null && row.usedCount >= row.usageLimit) return 'used_up';
  if (row.startsAt && now < row.startsAt) return 'scheduled';
  return 'active';
}

function toView(row: ViewRow): CouponView {
  const { products, ...rest } = row;
  return { ...rest, products: products.map((entry) => entry.product), state: couponState(row) };
}

function stateWhere(state: CouponState, now: Date): Prisma.CouponWhereInput {
  const notEnded = { OR: [{ endsAt: null }, { endsAt: { gt: now } }] };

  switch (state) {
    case 'inactive':
      return { isActive: false };
    case 'expired':
      return { isActive: true, endsAt: { lte: now } };
    case 'scheduled':
      return { isActive: true, startsAt: { gt: now }, ...notEnded };
    case 'used_up':
    case 'active':
      // The usage-limit comparison is between two columns, which Prisma's filters cannot say;
      // the page is filtered by state after reading. Listings stay bounded by the page size.
      return {
        isActive: true,
        AND: [notEnded, { OR: [{ startsAt: null }, { startsAt: { lte: now } }] }],
      };
  }
}

export async function listCoupons(
  pagination: Pagination,
  filters: { readonly q?: string; readonly state?: CouponState },
  now: Date = new Date(),
): Promise<{ items: CouponView[]; total: number }> {
  const where: Prisma.CouponWhereInput = {
    ...(filters.q ? { code: { contains: normaliseCouponCode(filters.q) } } : {}),
    ...(filters.state ? stateWhere(filters.state, now) : {}),
  };

  if (filters.state === 'active' || filters.state === 'used_up') {
    // Narrowed in memory (see `stateWhere`): coupons are a short list, so this reads them all
    // with the database filter, then pages what is left.
    const rows = await prisma.coupon.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 5_000,
      select: VIEW_SELECT,
    });
    const matching = rows.map(toView).filter((view) => view.state === filters.state);
    const { skip, take } = toSkipTake(pagination);
    return { items: matching.slice(skip, skip + take), total: matching.length };
  }

  const { skip, take } = toSkipTake(pagination);
  const [rows, total] = await Promise.all([
    prisma.coupon.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: VIEW_SELECT,
    }),
    prisma.coupon.count({ where }),
  ]);

  return { items: rows.map(toView), total };
}

export async function getCoupon(couponId: string): Promise<CouponView> {
  const row = await prisma.coupon.findUnique({ where: { id: couponId }, select: VIEW_SELECT });
  if (!row) throw notFound('That coupon does not exist.');
  return toView(row);
}

async function assertProductsExist(tx: TransactionClient, ids: readonly string[]): Promise<void> {
  if (ids.length === 0) return;
  const found = await tx.product.count({ where: { id: { in: [...ids] } } });
  if (found !== new Set(ids).size) {
    throw validationFailed([{ field: 'productIds', issue: 'One or more products do not exist' }]);
  }
}

function auditContext(context: AdminActionContext) {
  return {
    actor: context.actor,
    ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
    ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
  };
}

/** What the audit row keeps: the terms, not the product names. */
function auditable(view: CouponView): Prisma.InputJsonObject {
  return {
    code: view.code,
    type: view.type,
    percentBps: view.percentBps,
    valueMinor: view.valueMinor,
    minimumSpendMinor: view.minimumSpendMinor,
    maxDiscountMinor: view.maxDiscountMinor,
    startsAt: view.startsAt?.toISOString() ?? null,
    endsAt: view.endsAt?.toISOString() ?? null,
    usageLimit: view.usageLimit,
    perUserLimit: view.perUserLimit,
    isActive: view.isActive,
    appliesToAllProducts: view.appliesToAllProducts,
    productIds: view.products.map((product) => product.id),
  };
}

export async function createCoupon(
  input: AdminCouponCreateInput,
  context: AdminActionContext,
): Promise<CouponView> {
  const { productIds, ...terms } = input;

  try {
    return await withTransaction(
      async (tx) => {
        await assertProductsExist(tx, productIds);

        const row = await tx.coupon.create({
          data: {
            ...terms,
            currency: terms.type === 'FIXED' ? env.STORE_CURRENCY : null,
            ...(terms.appliesToAllProducts
              ? {}
              : {
                  products: {
                    create: [...new Set(productIds)].map((productId) => ({ productId })),
                  },
                }),
          },
          select: VIEW_SELECT,
        });
        const view = toView(row);

        await recordAudit(tx, {
          action: AuditAction.COUPON_CREATED,
          entityType: 'Coupon',
          entityId: view.id,
          after: auditable(view),
          ...auditContext(context),
        });

        return view;
      },
      { label: 'coupons.create' },
    );
  } catch (error) {
    if (isUniqueViolation(error)) throw conflict('A coupon with that code already exists.');
    throw error;
  }
}

export async function updateCoupon(
  couponId: string,
  input: AdminCouponUpdateInput,
  context: AdminActionContext,
): Promise<CouponView> {
  return withTransaction(
    async (tx) => {
      // Locked, so a concurrent redemption cannot slip under a new, lower usage limit.
      await tx.$queryRaw`SELECT id FROM coupons WHERE id = ${couponId} FOR NO KEY UPDATE`;
      const current = await tx.coupon.findUnique({ where: { id: couponId }, select: VIEW_SELECT });
      if (!current) throw notFound('That coupon does not exist.');

      const before = toView(current);
      const { productIds, ...changes } = input;

      if (current.type === 'PERCENT' && changes.valueMinor !== undefined) {
        throw validationFailed([
          { field: 'valueMinor', issue: 'A percentage coupon has no amount' },
        ]);
      }
      if (current.type === 'FIXED' && changes.percentBps !== undefined) {
        throw validationFailed([
          { field: 'percentBps', issue: 'A fixed coupon has no percentage' },
        ]);
      }

      const usageLimit = changes.usageLimit === undefined ? current.usageLimit : changes.usageLimit;
      if (usageLimit !== null && usageLimit < current.usedCount) {
        throw conflict(
          `This coupon has been used ${String(current.usedCount)} times; its limit cannot be lower.`,
        );
      }

      const startsAt = changes.startsAt === undefined ? current.startsAt : changes.startsAt;
      const endsAt = changes.endsAt === undefined ? current.endsAt : changes.endsAt;
      if (startsAt && endsAt && endsAt <= startsAt) {
        throw validationFailed([{ field: 'endsAt', issue: 'Must be after the start' }]);
      }

      const appliesToAll = changes.appliesToAllProducts ?? current.appliesToAllProducts;
      const nextProducts = productIds ?? current.products.map((entry) => entry.product.id);

      if (!appliesToAll && nextProducts.length === 0) {
        throw validationFailed([
          {
            field: 'productIds',
            issue: 'Choose at least one product, or let it apply to all products',
          },
        ]);
      }

      if (productIds !== undefined) {
        await assertProductsExist(tx, productIds);
        await tx.couponProduct.deleteMany({ where: { couponId } });
        await tx.couponProduct.createMany({
          data: [...new Set(productIds)].map((productId) => ({ couponId, productId })),
        });
      }

      // `exactOptionalPropertyTypes`: an absent field means "unchanged", never "set to undefined".
      const data = Object.fromEntries(
        Object.entries(changes).filter(([, value]) => value !== undefined),
      ) as Prisma.CouponUpdateInput;
      const row = await tx.coupon.update({ where: { id: couponId }, data, select: VIEW_SELECT });
      const after = toView(row);

      await recordAudit(tx, {
        action: AuditAction.COUPON_UPDATED,
        entityType: 'Coupon',
        entityId: couponId,
        before: auditable(before),
        after: auditable(after),
        ...auditContext(context),
      });

      return after;
    },
    { label: 'coupons.update' },
  );
}
