import { z } from 'zod';

import { opaqueId } from '../../http/schemas.js';
import { MAX_CART_LINES, MAX_LINE_QUANTITY } from '../cart/cart.schemas.js';
import { couponCode } from '../coupons/coupons.schemas.js';
import { countryCode, requiredText } from '../identity/identity.schemas.js';
import { DELIVERY_OPTION_IDS } from '../pricing/pricing.js';

/**
 * Request shapes for checkout (API_SPEC.md §6, architecture.md §7).
 *
 * The client names what it wants: variants, quantities, an address, a delivery option. Nothing
 * here can carry a price, fee or stock level, and `strictObject` turns an attempt to send one
 * into a 400 rather than a silently dropped field. `expectedTotalMinor` is the one amount in a
 * body and it is a guard, not an input: it can only stop an order, never set what is charged.
 */
const checkoutItem = z.strictObject({
  variantId: opaqueId,
  quantity: z.number().int().min(1).max(MAX_LINE_QUANTITY),
});

const checkoutItems = z
  .array(checkoutItem)
  .min(1)
  .max(MAX_CART_LINES)
  .refine(
    (items) => new Set(items.map((item) => item.variantId)).size === items.length,
    'Each item may appear only once.',
  );

const deliveryOption = z.enum(DELIVERY_OPTION_IDS);

/** Needed for a courier to reach the customer, and a COD order is settled at the door. */
const contactPhone = z
  .string()
  .trim()
  .regex(/^\+?[0-9][0-9\s()-]{6,30}$/, 'Enter a valid phone number');

export const checkoutQuoteBody = z.strictObject({
  items: checkoutItems,
  /** Optional so the page can show the items before an address has been entered. */
  destination: z.strictObject({ city: requiredText(120), countryCode }).optional(),
  deliveryOption: deliveryOption.default('standard'),
  /** One code per order (ADR 0022). A code that does not apply is reported, not refused. */
  couponCode: couponCode.optional(),
});

export type CheckoutQuoteInput = z.output<typeof checkoutQuoteBody>;

const shippingAddress = z.strictObject({
  recipientName: requiredText(120),
  phone: contactPhone,
  line1: requiredText(200),
  line2: requiredText(200).nullable().default(null),
  city: requiredText(120),
  state: requiredText(120).nullable().default(null),
  postalCode: requiredText(32),
  countryCode,
});

export const placeOrderBody = z.strictObject({
  items: checkoutItems,
  shipping: shippingAddress,
  deliveryOption,
  /** `ONLINE` needs a configured provider and a total within its limits; otherwise a 400. */
  paymentMethod: z.enum(['COD', 'ONLINE']),
  saveAddress: z.boolean().default(false),
  /** A code that does not apply refuses the order (409 COUPON_INVALID) with the reason. */
  couponCode: couponCode.optional(),
  /** The total the customer was shown. Must match what the server computes (409 otherwise). */
  expectedTotalMinor: z.number().int().min(0),
});

export type PlaceOrderInput = z.output<typeof placeOrderBody>;
