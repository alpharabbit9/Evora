import { describe, expect, it } from 'vitest';

import { isAppError } from '../src/http/errors.js';
import { csvField, minorToDecimal, toCsv } from '../src/lib/csv.js';
import { assertImageStorageEnabled } from '../src/modules/admin/admin-catalog.service.js';
import { listDays, resolveRange, storeToday } from '../src/modules/analytics/date-range.js';
import { couponState } from '../src/modules/coupons/coupons.service.js';
import {
  type CouponTerms,
  evaluateCoupon,
  normaliseCouponCode,
} from '../src/modules/pricing/coupons.js';
import {
  DEFAULT_PRICING,
  computeOrderTotals,
  listDeliveryOptions,
  offeredDeliveryOptions,
  shippingChargeMinor,
  taxMinor,
} from '../src/modules/pricing/pricing.js';

/** M10 (ADR 0022): the pure rules behind coupons, settings-driven pricing, CSV and date ranges. */

const NOW = new Date('2026-11-11T06:00:00Z');
const CONTEXT = { now: NOW, currency: 'BDT' };

function coupon(overrides: Partial<CouponTerms> = {}): CouponTerms {
  return {
    code: 'SAVE10',
    type: 'PERCENT',
    percentBps: 1000,
    valueMinor: null,
    currency: null,
    minimumSpendMinor: null,
    maxDiscountMinor: null,
    startsAt: null,
    endsAt: null,
    isActive: true,
    appliesToAllProducts: true,
    productIds: [],
    ...overrides,
  };
}

const LINES = [
  { productId: 'shoe', unitPriceMinor: 250_000, quantity: 2 },
  { productId: 'bag', unitPriceMinor: 99_950, quantity: 1 },
];

describe('coupon evaluation', () => {
  it('takes a percentage of the subtotal, rounded down', () => {
    expect(evaluateCoupon(coupon(), LINES, CONTEXT)).toEqual({ ok: true, discountMinor: 59_995 });
    expect(evaluateCoupon(coupon({ percentBps: 333 }), LINES, CONTEXT)).toEqual({
      ok: true,
      discountMinor: 19_978,
    });
  });

  it('caps a percentage at its maximum discount', () => {
    expect(evaluateCoupon(coupon({ maxDiscountMinor: 10_000 }), LINES, CONTEXT)).toEqual({
      ok: true,
      discountMinor: 10_000,
    });
  });

  it('never takes off more than the eligible lines cost', () => {
    const fixed = coupon({
      type: 'FIXED',
      percentBps: null,
      valueMinor: 5_000_000,
      currency: 'BDT',
    });
    expect(evaluateCoupon(fixed, LINES, CONTEXT)).toEqual({ ok: true, discountMinor: 599_950 });
  });

  it('applies only to the products it names', () => {
    const restricted = coupon({ appliesToAllProducts: false, productIds: ['bag'] });
    expect(evaluateCoupon(restricted, LINES, CONTEXT)).toEqual({ ok: true, discountMinor: 9_995 });
    expect(
      evaluateCoupon(coupon({ appliesToAllProducts: false, productIds: ['hat'] }), LINES, CONTEXT),
    ).toEqual({ ok: false, reason: 'NOT_ELIGIBLE' });
  });

  it('refuses outside its window, when inactive, under the minimum spend or in another currency', () => {
    expect(evaluateCoupon(coupon({ isActive: false }), LINES, CONTEXT)).toMatchObject({
      reason: 'INACTIVE',
    });
    expect(
      evaluateCoupon(coupon({ startsAt: new Date('2026-11-12T00:00:00Z') }), LINES, CONTEXT),
    ).toMatchObject({ reason: 'NOT_STARTED' });
    // The end is exclusive: at that instant it has expired.
    expect(evaluateCoupon(coupon({ endsAt: NOW }), LINES, CONTEXT)).toMatchObject({
      reason: 'EXPIRED',
    });
    expect(evaluateCoupon(coupon({ minimumSpendMinor: 600_000 }), LINES, CONTEXT)).toMatchObject({
      reason: 'MINIMUM_SPEND',
    });
    expect(evaluateCoupon(coupon({ minimumSpendMinor: 599_950 }), LINES, CONTEXT).ok).toBe(true);
    expect(
      evaluateCoupon(
        coupon({ type: 'FIXED', percentBps: null, valueMinor: 100, currency: 'USD' }),
        LINES,
        CONTEXT,
      ),
    ).toMatchObject({ reason: 'WRONG_CURRENCY' });
  });

  it('normalises what a customer types', () => {
    expect(normaliseCouponCode('  save10 ')).toBe('SAVE10');
  });

  it('describes a coupon by what it can do right now', () => {
    const base = { isActive: true, startsAt: null, endsAt: null, usageLimit: null, usedCount: 0 };
    expect(couponState(base, NOW)).toBe('active');
    expect(couponState({ ...base, isActive: false }, NOW)).toBe('inactive');
    expect(couponState({ ...base, endsAt: NOW }, NOW)).toBe('expired');
    expect(couponState({ ...base, usageLimit: 3, usedCount: 3 }, NOW)).toBe('used_up');
    expect(couponState({ ...base, startsAt: new Date('2027-01-01T00:00:00Z') }, NOW)).toBe(
      'scheduled',
    );
  });
});

describe('pricing with settings', () => {
  const dhaka = { city: 'Dhaka', countryCode: 'BD' };

  it('keeps the total identity with a discount and tax', () => {
    const totals = computeOrderTotals(LINES, 8_000, { discountMinor: 59_995, taxRateBps: 1500 });
    expect(totals).toEqual({
      subtotalMinor: 599_950,
      discountMinor: 59_995,
      shippingMinor: 8_000,
      // 15 % of 539,955, half up.
      taxMinor: 80_993,
      totalMinor: 599_950 - 59_995 + 8_000 + 80_993,
    });
  });

  it('never discounts below zero merchandise', () => {
    expect(computeOrderTotals(LINES, 0, { discountMinor: 10_000_000 }).discountMinor).toBe(599_950);
  });

  it('rounds tax half up', () => {
    expect(taxMinor(1, 5000)).toBe(1);
    expect(taxMinor(1, 4999)).toBe(0);
    expect(taxMinor(10_000, 0)).toBe(0);
  });

  it('makes delivery free at the threshold, compared with the discounted subtotal', () => {
    const settings = { ...DEFAULT_PRICING, freeShippingThresholdMinor: 500_000 };
    expect(shippingChargeMinor('standard', dhaka, 500_000, settings)).toBe(0);
    expect(shippingChargeMinor('standard', dhaka, 499_999, settings)).toBe(8_000);
    expect(shippingChargeMinor('standard', dhaka, 1_000_000, DEFAULT_PRICING)).toBe(8_000);
  });

  it('stops offering express when it is switched off', () => {
    const settings = { ...DEFAULT_PRICING, expressEnabled: false };
    expect(offeredDeliveryOptions(settings)).toEqual(['standard']);
    expect(listDeliveryOptions(dhaka, settings).map((option) => option.id)).toEqual(['standard']);
  });
});

describe('CSV', () => {
  it('quotes every field and doubles quotes', () => {
    expect(csvField('He said "hi"')).toBe('"He said ""hi"""');
    expect(csvField(null)).toBe('""');
    expect(csvField(3)).toBe('"3"');
  });

  it('neutralises what a spreadsheet would run as a formula', () => {
    for (const attack of ['=HYPERLINK("http://x")', '+1+1', '-2', '@SUM(A1)', '\tcmd']) {
      expect(csvField(attack).startsWith(`"'`)).toBe(true);
    }
    expect(csvField('Dhaka')).toBe('"Dhaka"');
  });

  it('starts with a byte-order mark and ends lines with CRLF', () => {
    const csv = toCsv(['a', 'b'], [[1, 'x']]);
    expect(csv.charCodeAt(0)).toBe(0xfeff);
    expect(csv.slice(1)).toBe('"a","b"\r\n"1","x"\r\n');
  });

  it('writes money as decimals', () => {
    expect(minorToDecimal(285_000)).toBe('2850.00');
    expect(minorToDecimal(5)).toBe('0.05');
    expect(minorToDecimal(-1_050)).toBe('-10.50');
  });
});

describe('store-day ranges', () => {
  it('uses the store day, UTC+06:00', () => {
    expect(storeToday(new Date('2026-11-10T18:30:00Z'))).toBe('2026-11-11');
    expect(storeToday(new Date('2026-11-10T17:59:59Z'))).toBe('2026-11-10');
  });

  it('covers whole store days and defaults to the last 30', () => {
    const range = resolveRange({ from: '2026-11-01', to: '2026-11-03' });
    expect(range.start.toISOString()).toBe('2026-10-31T18:00:00.000Z');
    expect(range.end.toISOString()).toBe('2026-11-03T18:00:00.000Z');
    expect(range.days).toBe(3);
    expect(listDays(range)).toEqual(['2026-11-01', '2026-11-02', '2026-11-03']);

    const fallback = resolveRange({}, { now: NOW });
    expect(fallback.to).toBe('2026-11-11');
    expect(fallback.days).toBe(30);
  });
});

describe('product images without a bucket', () => {
  it('refuses to attach an image when storage is disabled, saying why', () => {
    let caught: unknown;
    try {
      assertImageStorageEnabled('disabled');
    } catch (error) {
      caught = error;
    }

    expect(isAppError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'CONFLICT',
      status: 409,
      message: expect.stringMatching(/Image storage is not set up/),
    });
  });

  it('allows it with a real store', () => {
    expect(() => assertImageStorageEnabled('s3')).not.toThrow();
    expect(() => assertImageStorageEnabled('filesystem')).not.toThrow();
  });
});
