import { validationFailed } from '../../http/errors.js';

/**
 * The one place money is added up (architecture.md §4, database-design.md §7). Pure on purpose:
 * no database, no clock, integer minor units only, so every rule here is unit-tested and the
 * quote and the order cannot disagree — both call these functions with prices read from
 * PostgreSQL. Nothing in this file takes a price or a fee from a client.
 *
 * Fees and the tax rate come from the store settings an administrator edits (M10, ADR 0022),
 * read by the caller and passed in. `DEFAULT_PRICING` is what applies until someone saves them:
 * ADR 0018's provisional delivery fees and no tax. Neither is a store policy yet (PRD §9).
 *
 * Order of operations, which the quote, the order and the receipt all share:
 *   subtotal → discount (coupon, merchandise only) → shipping (free above the threshold, compared
 *   with the discounted subtotal) → tax (exclusive, on the discounted merchandise, not on shipping)
 *   → total = subtotal − discount + shipping + tax (`orders_total_identity_check`).
 */

/** Where the store delivers. A store in BDT with no decided export policy ships at home. */
export const SHIPPING_COUNTRIES: readonly string[] = ['BD'];

export const DELIVERY_OPTION_IDS = ['standard', 'express'] as const;

export type DeliveryOptionId = (typeof DELIVERY_OPTION_IDS)[number];

export type ShippingZone = 'dhaka' | 'national';

export interface PricingSettings {
  readonly feesMinor: Readonly<Record<DeliveryOptionId, Readonly<Record<ShippingZone, number>>>>;
  readonly expressEnabled: boolean;
  /** Delivery is free when the discounted subtotal reaches this; `null` = never free. */
  readonly freeShippingThresholdMinor: number | null;
  /** Exclusive tax in basis points (1500 = 15.00 %). */
  readonly taxRateBps: number;
}

export const DEFAULT_PRICING: PricingSettings = {
  feesMinor: {
    standard: { dhaka: 8_000, national: 15_000 },
    express: { dhaka: 15_000, national: 25_000 },
  },
  expressEnabled: true,
  freeShippingThresholdMinor: null,
  taxRateBps: 0,
};

const OPTION_TEXT: Readonly<Record<DeliveryOptionId, { label: string; estimate: string }>> = {
  standard: { label: 'Standard delivery', estimate: 'Usually 3–5 working days' },
  express: { label: 'Express delivery', estimate: 'Usually 1–2 working days' },
};

/** The largest amount a `*_minor` INTEGER column can hold. */
export const MAX_MONEY_MINOR = 2_147_483_647;

export interface Destination {
  readonly city: string;
  readonly countryCode: string;
}

/**
 * The zone comes from the address, not from a choice the customer makes, so the cheaper rate
 * cannot simply be selected for a delivery that is not in Dhaka.
 */
function zoneOf(destination: Destination): ShippingZone {
  return destination.city.trim().toLowerCase() === 'dhaka' ? 'dhaka' : 'national';
}

export function assertDeliverable(destination: Destination, field: string): void {
  if (!SHIPPING_COUNTRIES.includes(destination.countryCode)) {
    throw validationFailed(
      [{ field, issue: 'We do not deliver to this country yet.' }],
      'We do not deliver to this country yet.',
    );
  }
}

export function offeredDeliveryOptions(settings: PricingSettings = DEFAULT_PRICING) {
  return DELIVERY_OPTION_IDS.filter((id) => id !== 'express' || settings.expressEnabled);
}

/** Refuses an option the store has switched off, so it cannot be chosen by a crafted request. */
export function assertDeliveryOption(
  option: DeliveryOptionId,
  settings: PricingSettings = DEFAULT_PRICING,
): void {
  if (!offeredDeliveryOptions(settings).includes(option)) {
    throw validationFailed([
      { field: 'deliveryOption', issue: 'This delivery option is not offered' },
    ]);
  }
}

/** The fee for the option and zone, before any free-delivery threshold. */
export function deliveryFeeMinor(
  option: DeliveryOptionId,
  destination: Destination,
  settings: PricingSettings = DEFAULT_PRICING,
): number {
  return settings.feesMinor[option][zoneOf(destination)];
}

/** What the customer pays for delivery, given what the merchandise comes to after discount. */
export function shippingChargeMinor(
  option: DeliveryOptionId,
  destination: Destination,
  merchandiseMinor: number,
  settings: PricingSettings = DEFAULT_PRICING,
): number {
  const threshold = settings.freeShippingThresholdMinor;

  if (threshold !== null && merchandiseMinor >= threshold) return 0;
  return deliveryFeeMinor(option, destination, settings);
}

export interface DeliveryOptionView {
  readonly id: DeliveryOptionId;
  readonly label: string;
  readonly estimate: string;
  /** `null` until the address is known: the fee depends on it. */
  readonly feeMinor: number | null;
}

export function listDeliveryOptions(
  destination: Destination | null,
  settings: PricingSettings = DEFAULT_PRICING,
  merchandiseMinor = 0,
): DeliveryOptionView[] {
  return offeredDeliveryOptions(settings).map((id) => ({
    id,
    label: OPTION_TEXT[id].label,
    estimate: OPTION_TEXT[id].estimate,
    feeMinor: destination ? shippingChargeMinor(id, destination, merchandiseMinor, settings) : null,
  }));
}

export interface PricedLine {
  readonly unitPriceMinor: number;
  readonly quantity: number;
}

export interface OrderTotals {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
}

export function lineTotalMinor(line: PricedLine): number {
  return line.unitPriceMinor * line.quantity;
}

export function subtotalMinor(lines: readonly PricedLine[]): number {
  return lines.reduce((sum, line) => sum + lineTotalMinor(line), 0);
}

/** Exclusive tax on an amount, rounded half up to the nearest poisha. */
export function taxMinor(amountMinor: number, rateBps: number): number {
  return Math.floor((amountMinor * rateBps + 5_000) / 10_000);
}

/**
 * Satisfies `orders_total_identity_check` by construction. An amount a column cannot hold is
 * refused here instead of failing as a database error.
 */
export function computeOrderTotals(
  lines: readonly PricedLine[],
  shippingMinor: number,
  options: { readonly discountMinor?: number; readonly taxRateBps?: number } = {},
): OrderTotals {
  const subtotal = subtotalMinor(lines);
  // Never more than the merchandise (`orders_discount_within_subtotal_check`).
  const discount = Math.min(subtotal, Math.max(0, options.discountMinor ?? 0));
  const tax = taxMinor(subtotal - discount, options.taxRateBps ?? 0);
  const totalMinor = subtotal - discount + shippingMinor + tax;

  if (totalMinor > MAX_MONEY_MINOR) {
    throw validationFailed(
      [{ field: 'items', issue: 'This order is too large to place in one go.' }],
      'This order is too large to place in one go.',
    );
  }

  return {
    subtotalMinor: subtotal,
    discountMinor: discount,
    shippingMinor,
    taxMinor: tax,
    totalMinor,
  };
}
