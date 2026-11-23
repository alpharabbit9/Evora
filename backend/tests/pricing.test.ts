import { describe, expect, it } from 'vitest';

import { AppError } from '../src/http/errors.js';
import {
  assertDeliverable,
  computeOrderTotals,
  deliveryFeeMinor,
  listDeliveryOptions,
} from '../src/modules/pricing/pricing.js';

const DHAKA = { city: 'Dhaka', countryCode: 'BD' };
const SYLHET = { city: 'Sylhet', countryCode: 'BD' };

describe('computeOrderTotals', () => {
  it('multiplies, adds shipping and keeps the order total identity', () => {
    const totals = computeOrderTotals(
      [
        { unitPriceMinor: 250_000, quantity: 2 },
        { unitPriceMinor: 99_950, quantity: 1 },
      ],
      8_000,
    );

    expect(totals).toEqual({
      subtotalMinor: 599_950,
      discountMinor: 0,
      shippingMinor: 8_000,
      taxMinor: 0,
      totalMinor: 607_950,
    });
    expect(totals.totalMinor).toBe(
      totals.subtotalMinor - totals.discountMinor + totals.shippingMinor + totals.taxMinor,
    );
  });

  it('refuses an amount the money columns cannot hold', () => {
    expect(() =>
      computeOrderTotals([{ unitPriceMinor: 2_147_483_647, quantity: 1 }], 1),
    ).toThrowError(AppError);
  });

  it('accepts the largest amount the money columns can hold', () => {
    expect(computeOrderTotals([{ unitPriceMinor: 2_147_483_647, quantity: 1 }], 0).totalMinor).toBe(
      2_147_483_647,
    );
  });
});

describe('delivery fees', () => {
  it('derives the zone from the address, ignoring case and surrounding space', () => {
    expect(deliveryFeeMinor('standard', { city: '  dHaKa ', countryCode: 'BD' })).toBe(
      deliveryFeeMinor('standard', DHAKA),
    );
  });

  it('charges more outside Dhaka and more for express', () => {
    expect(deliveryFeeMinor('standard', SYLHET)).toBeGreaterThan(
      deliveryFeeMinor('standard', DHAKA),
    );
    expect(deliveryFeeMinor('express', DHAKA)).toBeGreaterThan(deliveryFeeMinor('standard', DHAKA));
  });

  it('lists no fee until the address is known', () => {
    expect(listDeliveryOptions(null).map((option) => option.feeMinor)).toEqual([null, null]);
    expect(listDeliveryOptions(DHAKA).map((option) => option.feeMinor)).toEqual([
      deliveryFeeMinor('standard', DHAKA),
      deliveryFeeMinor('express', DHAKA),
    ]);
  });

  it('refuses a country the store does not deliver to, naming the field', () => {
    expect(() => {
      assertDeliverable({ city: 'Dhaka', countryCode: 'US' }, 'shipping.countryCode');
    }).toThrowError(expect.objectContaining({ code: 'VALIDATION_ERROR' }) as Error);
    expect(() => {
      assertDeliverable(DHAKA, 'shipping.countryCode');
    }).not.toThrow();
  });
});
