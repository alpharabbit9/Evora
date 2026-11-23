import { lineTotalMinor } from './pricing.js';

/**
 * Whether a coupon applies to a basket, and what it takes off (M10, ADR 0022). Pure: the caller
 * reads the coupon and the lines from PostgreSQL and passes in the clock, so the quote and the order
 * share one answer and every rule is unit-tested.
 *
 * PROVISIONAL rules (PRD §9 has not decided coupon policy):
 *  - one coupon per order, no stacking;
 *  - it discounts merchandise only, never delivery or tax;
 *  - the minimum spend is compared with the whole subtotal, before any discount;
 *  - a percentage is of the eligible lines' subtotal, rounded down, then capped at `maxDiscount`;
 *  - a fixed amount is capped at the eligible lines' subtotal.
 *
 * Usage limits are not checked here: they need a lock, which `modules/coupons` takes inside the
 * order's transaction.
 */
export interface CouponTerms {
  readonly code: string;
  readonly type: 'PERCENT' | 'FIXED';
  readonly percentBps: number | null;
  readonly valueMinor: number | null;
  readonly currency: string | null;
  readonly minimumSpendMinor: number | null;
  readonly maxDiscountMinor: number | null;
  readonly startsAt: Date | null;
  readonly endsAt: Date | null;
  readonly isActive: boolean;
  readonly appliesToAllProducts: boolean;
  /** Only read when `appliesToAllProducts` is false. */
  readonly productIds: readonly string[];
}

export interface CouponLine {
  readonly productId: string;
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

export type CouponRefusal =
  'INACTIVE' | 'NOT_STARTED' | 'EXPIRED' | 'WRONG_CURRENCY' | 'MINIMUM_SPEND' | 'NOT_ELIGIBLE';

export type CouponOutcome =
  | { readonly ok: true; readonly discountMinor: number }
  | { readonly ok: false; readonly reason: CouponRefusal };

/** Shown to the customer as given; the wording says what to do, not just that it failed. */
export const COUPON_REFUSAL_MESSAGE: Readonly<
  Record<CouponRefusal | 'UNKNOWN' | 'USED_UP', string>
> = {
  UNKNOWN: 'That code is not valid.',
  INACTIVE: 'That code is no longer valid.',
  NOT_STARTED: 'That code cannot be used yet.',
  EXPIRED: 'That code has expired.',
  WRONG_CURRENCY: 'That code cannot be used in this store.',
  MINIMUM_SPEND: 'Your order does not reach the minimum spend for that code.',
  NOT_ELIGIBLE: 'That code does not apply to anything in your order.',
  USED_UP: 'That code has already been used as many times as it allows.',
};

/** What a customer types, as the database stores it (`coupons_code_uppercase_check`). */
export function normaliseCouponCode(code: string): string {
  return code.trim().toUpperCase();
}

export function evaluateCoupon(
  coupon: CouponTerms,
  lines: readonly CouponLine[],
  context: { readonly now: Date; readonly currency: string },
): CouponOutcome {
  if (!coupon.isActive) return { ok: false, reason: 'INACTIVE' };
  if (coupon.startsAt && context.now < coupon.startsAt) return { ok: false, reason: 'NOT_STARTED' };
  if (coupon.endsAt && context.now >= coupon.endsAt) return { ok: false, reason: 'EXPIRED' };
  if (coupon.type === 'FIXED' && coupon.currency !== context.currency) {
    return { ok: false, reason: 'WRONG_CURRENCY' };
  }

  const subtotal = lines.reduce((sum, line) => sum + lineTotalMinor(line), 0);

  if (coupon.minimumSpendMinor !== null && subtotal < coupon.minimumSpendMinor) {
    return { ok: false, reason: 'MINIMUM_SPEND' };
  }

  const eligible = coupon.appliesToAllProducts
    ? lines
    : lines.filter((line) => coupon.productIds.includes(line.productId));
  const eligibleMinor = eligible.reduce((sum, line) => sum + lineTotalMinor(line), 0);

  if (eligibleMinor === 0) return { ok: false, reason: 'NOT_ELIGIBLE' };

  let discount =
    coupon.type === 'PERCENT'
      ? Math.floor((eligibleMinor * (coupon.percentBps ?? 0)) / 10_000)
      : Math.min(eligibleMinor, coupon.valueMinor ?? 0);

  if (coupon.maxDiscountMinor !== null) discount = Math.min(discount, coupon.maxDiscountMinor);

  // A percentage of a tiny basket can round to nothing; that is still "applies", worth nothing.
  return { ok: true, discountMinor: Math.max(0, discount) };
}
