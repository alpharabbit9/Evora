import { createHash, randomBytes } from 'node:crypto';

import { type Prisma, ProductImageKind } from '@prisma/client';

import { env } from '../../config/env.js';
import { conflict, idempotencyConflict, notFound, validationFailed } from '../../http/errors.js';
import type { Actor } from '../../http/guards.js';
import { type ImageView, toImageView } from '../../lib/media.js';
import { prisma } from '../../lib/prisma.js';
import { isUniqueViolation } from '../../lib/prisma-errors.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import { type CartLineStatus, lineStatus } from '../cart/cart.service.js';
import { PURCHASABLE_VARIANT_WHERE, publicProductWhere } from '../catalog/publication.js';
import { readOption } from '../catalog/sizes.js';
import {
  type CouponPrice,
  type CouponQuote,
  priceCoupon,
  quoteCoupon,
  redeemCoupon,
} from '../coupons/coupons.service.js';
import { claimStock, queueLowStockAlerts } from '../inventory/inventory.service.js';
import { type OrderDetailView, getOwnOrder } from '../orders/orders.service.js';
import {
  type OfferedPaymentMethod,
  onlineProvider,
  paymentMethodsFor,
} from '../payments/provider-registry.js';
import { normaliseCouponCode } from '../pricing/coupons.js';
import {
  type DeliveryOptionId,
  type DeliveryOptionView,
  assertDeliverable,
  assertDeliveryOption,
  computeOrderTotals,
  lineTotalMinor,
  listDeliveryOptions,
  offeredDeliveryOptions,
  shippingChargeMinor,
  subtotalMinor,
} from '../pricing/pricing.js';
import { getStoreSettings, pricingOf } from '../settings/settings.service.js';
import type { CheckoutQuoteInput, PlaceOrderInput } from './checkout.schemas.js';

/**
 * Checkout (architecture.md §7, ADR 0018). The quote and the order share one pricing module and
 * read prices and availability from PostgreSQL on every call; the cart is not consulted for
 * either, because it is advisory (PRD §6 rule 4).
 *
 * Placing an order is one short transaction with no network call inside it: the order row, its
 * item snapshots, the stock claims and movements, the initial payment state and the receipt's
 * outbox event commit together or not at all.
 *
 * Idempotency. `Idempotency-Key` plus a fingerprint of the request are stored on the order, so:
 *   - same key, same request: the prior order is returned and nothing else happens;
 *   - same key, different request: 409 IDEMPOTENCY_CONFLICT;
 *   - a request that failed before commit left no row, so its key may simply be used again.
 *     Re-running it is the right behaviour, because it failed for reasons that can change (stock
 *     came back, a connection dropped). That is why no separate request table exists.
 *
 * Concurrent duplicates are settled by `orders.idempotency_key` being unique. The order row is
 * inserted BEFORE any stock is claimed, so the second request blocks on the unique index until
 * the first commits, fails without having claimed anything, and answers with the first's order.
 */

const LINE_SELECT = {
  id: true,
  sku: true,
  options: true,
  priceMinor: true,
  stockQuantity: true,
  lowStockThreshold: true,
  productId: true,
  product: {
    select: {
      slug: true,
      name: true,
      brand: true,
      images: {
        where: { kind: ProductImageKind.PHOTO },
        orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
        take: 1,
        select: { objectKey: true, altText: true, widthPx: true, heightPx: true },
      },
    },
  },
} satisfies Prisma.ProductVariantSelect;

export interface CheckoutQuoteLine {
  readonly variantId: string;
  readonly quantity: number;
  readonly status: CartLineStatus;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly color: string | null;
  readonly size: string | null;
  readonly product: {
    readonly slug: string;
    readonly name: string;
    readonly brand: string | null;
    readonly image: ImageView | null;
  };
}

export interface CheckoutQuote {
  readonly currency: string;
  readonly items: readonly CheckoutQuoteLine[];
  readonly deliveryOptions: readonly DeliveryOptionView[];
  readonly deliveryOption: DeliveryOptionId;
  /** `available` lines only. */
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  /** `null` until a destination is given. */
  readonly shippingMinor: number | null;
  readonly totalMinor: number | null;
  readonly paymentMethods: readonly OfferedPaymentMethod[];
  readonly hasIssues: boolean;
  /** The code asked about and what it does, or `null` when none was given. */
  readonly coupon: CouponQuote | null;
  /** Delivery is free once the discounted subtotal reaches this; `null` = never. */
  readonly freeShippingThresholdMinor: number | null;
}

/** Reads and reports; it claims nothing. An unavailable line or a refused code is a status. */
export async function quoteCheckout(
  actor: Actor,
  input: CheckoutQuoteInput,
): Promise<CheckoutQuote> {
  const ids = input.items.map((item) => item.variantId);

  const [variants, purchasable] = await Promise.all([
    prisma.productVariant.findMany({ where: { id: { in: ids } }, select: LINE_SELECT }),
    prisma.productVariant.findMany({
      where: { id: { in: ids }, ...PURCHASABLE_VARIANT_WHERE, product: publicProductWhere() },
      select: { id: true },
    }),
  ]);

  const byId = new Map(variants.map((variant) => [variant.id, variant]));
  const sellable = new Set(purchasable.map((variant) => variant.id));

  const items: CheckoutQuoteLine[] = input.items.map((item) => {
    const variant = byId.get(item.variantId);

    if (!variant) {
      throw notFound('That item is not available.');
    }

    const image = variant.product.images[0];

    return {
      variantId: variant.id,
      quantity: item.quantity,
      status: lineStatus(sellable.has(variant.id), variant.stockQuantity, item.quantity),
      unitPriceMinor: variant.priceMinor,
      lineTotalMinor: lineTotalMinor({
        unitPriceMinor: variant.priceMinor,
        quantity: item.quantity,
      }),
      color: readOption(variant.options, 'color'),
      size: readOption(variant.options, 'size'),
      product: {
        slug: variant.product.slug,
        name: variant.product.name,
        brand: variant.product.brand,
        image: image ? toImageView(image) : null,
      },
    };
  });

  const destination = input.destination ?? null;

  if (destination) {
    assertDeliverable(destination, 'destination.countryCode');
  }

  const pricing = pricingOf(await getStoreSettings());
  // An option switched off since the page loaded falls back to standard, which is always offered.
  const deliveryOption = offeredDeliveryOptions(pricing).includes(input.deliveryOption)
    ? input.deliveryOption
    : 'standard';

  const available = items
    .filter((item) => item.status === 'available')
    .map((item) => ({
      productId: byId.get(item.variantId)?.productId ?? '',
      unitPriceMinor: item.unitPriceMinor,
      quantity: item.quantity,
    }));

  const coupon = input.couponCode ? await quoteCoupon(input.couponCode, available, actor.id) : null;
  const discountMinor = coupon?.status === 'applied' ? coupon.discountMinor : 0;
  const merchandiseMinor = Math.max(0, subtotalMinor(available) - discountMinor);
  const shippingMinor = destination
    ? shippingChargeMinor(deliveryOption, destination, merchandiseMinor, pricing)
    : null;
  const totals = computeOrderTotals(available, shippingMinor ?? 0, {
    discountMinor,
    taxRateBps: pricing.taxRateBps,
  });

  return {
    currency: env.STORE_CURRENCY,
    items,
    deliveryOptions: listDeliveryOptions(destination, pricing, merchandiseMinor),
    deliveryOption,
    subtotalMinor: totals.subtotalMinor,
    discountMinor: totals.discountMinor,
    taxMinor: totals.taxMinor,
    shippingMinor,
    totalMinor: destination ? totals.totalMinor : null,
    paymentMethods: paymentMethodsFor(onlineProvider(), destination ? totals.totalMinor : null),
    hasIssues: items.some((item) => item.status !== 'available'),
    coupon,
    freeShippingThresholdMinor: pricing.freeShippingThresholdMinor,
  };
}

/**
 * Stored instead of the raw key, so keys are per customer: two accounts that happen to send the
 * same key get two orders, and neither can use a key to find out about or receive the other's.
 */
function scopedIdempotencyKey(userId: string, key: string): string {
  return createHash('sha256').update(`${userId}:${key}`).digest('hex');
}

/**
 * What the customer asked for, independent of item order. `expectedTotalMinor` is left out: it
 * says what they were shown, not what they are buying, so a retry after a re-quote is still the
 * same request and must find the order the first attempt created.
 */
function requestFingerprint(input: PlaceOrderInput): string {
  const items = [...input.items]
    .sort((a, b) => a.variantId.localeCompare(b.variantId))
    .map((item) => [item.variantId, item.quantity]);
  const { shipping } = input;

  return createHash('sha256')
    .update(
      JSON.stringify({
        items,
        shipping: [
          shipping.recipientName,
          shipping.phone,
          shipping.line1,
          shipping.line2,
          shipping.city,
          shipping.state,
          shipping.postalCode,
          shipping.countryCode,
        ],
        deliveryOption: input.deliveryOption,
        paymentMethod: input.paymentMethod,
        saveAddress: input.saveAddress,
        couponCode: input.couponCode ? normaliseCouponCode(input.couponCode) : null,
      }),
    )
    .digest('hex');
}

/** Crockford base32, which has no I, L, O or U to misread on the phone to a courier. */
const ORDER_NUMBER_ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';

/**
 * Random rather than sequential (schema note on `Order`): 12 characters are 60 bits, so the
 * number reveals neither order volume nor another customer's order. 256 is a multiple of the
 * alphabet's 32 characters, so the modulo is not biased.
 */
function generateOrderNumber(): string {
  const characters = Array.from(
    randomBytes(12),
    (byte) => ORDER_NUMBER_ALPHABET[byte % ORDER_NUMBER_ALPHABET.length],
  );

  return `CC-${characters.join('')}`;
}

async function createOrder(
  tx: TransactionClient,
  actor: Actor,
  key: string,
  fingerprint: string,
  input: PlaceOrderInput,
): Promise<string> {
  const ids = input.items.map((item) => item.variantId);

  // Re-read inside the transaction, whatever the quote said a moment ago.
  const variants = await tx.productVariant.findMany({
    where: { id: { in: ids }, ...PURCHASABLE_VARIANT_WHERE, product: publicProductWhere() },
    select: LINE_SELECT,
  });
  const byId = new Map(variants.map((variant) => [variant.id, variant]));

  const lines = input.items.map((item) => {
    const variant = byId.get(item.variantId);

    if (!variant) {
      throw conflict('An item in your order is no longer available. Review your bag.', {
        details: [{ field: `items.${item.variantId}`, issue: 'No longer available' }],
      });
    }

    return { variant, quantity: item.quantity, unitPriceMinor: variant.priceMinor };
  });

  // In force when this order commits, read under its snapshot.
  const pricing = pricingOf(await getStoreSettings(tx));
  assertDeliveryOption(input.deliveryOption, pricing);

  const now = new Date();
  const couponLines = lines.map((line) => ({
    productId: line.variant.productId,
    unitPriceMinor: line.unitPriceMinor,
    quantity: line.quantity,
  }));
  const coupon: CouponPrice | null = input.couponCode
    ? await priceCoupon(tx, input.couponCode, couponLines, now)
    : null;
  const discountMinor = coupon?.discountMinor ?? 0;

  const shippingMinor = shippingChargeMinor(
    input.deliveryOption,
    input.shipping,
    Math.max(0, subtotalMinor(lines) - discountMinor),
    pricing,
  );
  const totals = computeOrderTotals(lines, shippingMinor, {
    discountMinor,
    taxRateBps: pricing.taxRateBps,
  });

  if (totals.totalMinor !== input.expectedTotalMinor) {
    throw conflict('The total for your order has changed. Please review it and try again.', {
      details: [{ field: 'expectedTotalMinor', issue: 'Does not match the current total' }],
    });
  }

  const provider = onlineProvider();
  const isOnline = input.paymentMethod === 'ONLINE';

  if (isOnline && !paymentMethodsFor(provider, totals.totalMinor).includes('ONLINE')) {
    throw validationFailed([
      { field: 'paymentMethod', issue: 'Online payment is not available for this order' },
    ]);
  }

  const { shipping } = input;

  const order = await tx.order.create({
    data: {
      orderNumber: generateOrderNumber(),
      userId: actor.id,
      // COD has no payment to wait for: the order is confirmed and the money is collected at the
      // door, which is its own state (API_SPEC.md §9). An online order waits for verified payment
      // evidence, and only the payments module can move it on (ADR 0019).
      status: isOnline ? 'PENDING_PAYMENT' : 'CONFIRMED',
      paymentStatus: isOnline ? 'PENDING' : 'COD_PENDING',
      paymentMethod: input.paymentMethod,
      currency: env.STORE_CURRENCY,
      ...totals,
      ...(coupon ? { couponId: coupon.couponId, couponCodeSnapshot: coupon.code } : {}),
      // The account's address, not a typed one: a receipt must not be a way to mail a stranger.
      contactEmail: actor.email,
      contactPhone: shipping.phone,
      shipRecipientName: shipping.recipientName,
      shipLine1: shipping.line1,
      shipLine2: shipping.line2,
      shipCity: shipping.city,
      shipState: shipping.state,
      shipPostalCode: shipping.postalCode,
      shipCountryCode: shipping.countryCode,
      shippingMethod: input.deliveryOption,
      idempotencyKey: key,
      requestFingerprint: fingerprint,
      items: {
        create: lines.map(({ variant, quantity, unitPriceMinor }) => ({
          productId: variant.productId,
          variantId: variant.id,
          productNameSnapshot: variant.product.name,
          skuSnapshot: variant.sku,
          variantOptionsSnapshot: variant.options as Prisma.InputJsonValue,
          unitPriceMinor,
          quantity,
          lineTotalMinor: lineTotalMinor({ unitPriceMinor, quantity }),
        })),
      },
      statusHistory: {
        create: {
          toStatus: isOnline ? 'PENDING_PAYMENT' : 'CONFIRMED',
          actorUserId: actor.id,
          reason: isOnline
            ? 'Order placed, awaiting online payment'
            : 'Order placed with cash on delivery',
        },
      },
      payments: {
        create: {
          provider: isOnline && provider ? provider.name : 'cod',
          method: input.paymentMethod,
          status: 'PENDING',
          amountMinor: totals.totalMinor,
          currency: env.STORE_CURRENCY,
          idempotencyKey: key,
        },
      },
    },
    select: { id: true, orderNumber: true },
  });

  const movements = await claimStock(tx, input.items, order.id);

  // After the stock claim: variants are always locked before a coupon (`modules/coupons`).
  if (coupon) {
    await redeemCoupon(tx, coupon, {
      orderId: order.id,
      userId: actor.id,
      lines: couponLines,
      now,
    });
  }

  await queueLowStockAlerts(
    tx,
    order.id,
    movements.map((movement) => {
      const variant = byId.get(movement.variantId);

      return {
        variantId: movement.variantId,
        sku: variant?.sku ?? '',
        previousQuantity: movement.resultingQuantity - movement.delta,
        currentQuantity: movement.resultingQuantity,
        threshold: variant?.lowStockThreshold ?? 0,
      };
    }),
  );

  // An online order has no receipt and keeps its bag until the money is verified: a customer whose
  // payment fails goes back to the bag they had (payments.service.ts does both on success).
  if (!isOnline) {
    // Identifiers only: the M9 worker reads the order when it sends, and a row that outlives its
    // delivery should not be holding an address.
    await tx.outboxEvent.create({
      data: {
        eventType: 'ORDER_RECEIPT',
        dedupeKey: `order-receipt:${order.id}`,
        payload: { orderId: order.id, orderNumber: order.orderNumber },
      },
    });

    await tx.cartItem.deleteMany({
      where: { variantId: { in: ids }, cart: { userId: actor.id, status: 'ACTIVE' } },
    });
  }

  if (input.saveAddress) {
    // Never the default: the default slot has a partial unique index, and placing an order must
    // not be able to fail on a race over it.
    await tx.address.create({
      data: {
        userId: actor.id,
        recipientName: shipping.recipientName,
        phone: shipping.phone,
        line1: shipping.line1,
        line2: shipping.line2,
        city: shipping.city,
        state: shipping.state,
        postalCode: shipping.postalCode,
        countryCode: shipping.countryCode,
      },
    });
  }

  return order.id;
}

export interface PlacedOrder {
  readonly order: OrderDetailView;
  /** True when this request found an order an earlier one created. */
  readonly replayed: boolean;
}

async function findPriorOrder(
  actor: Actor,
  key: string,
  fingerprint: string,
): Promise<PlacedOrder | null> {
  const prior = await prisma.order.findUnique({
    where: { idempotencyKey: key },
    select: { id: true, requestFingerprint: true },
  });

  if (!prior) {
    return null;
  }

  if (prior.requestFingerprint !== fingerprint) {
    throw idempotencyConflict();
  }

  return { order: await getOwnOrder(actor.id, prior.id), replayed: true };
}

export async function placeOrder(
  actor: Actor,
  idempotencyKey: string,
  input: PlaceOrderInput,
): Promise<PlacedOrder> {
  assertDeliverable(input.shipping, 'shipping.countryCode');

  const key = scopedIdempotencyKey(actor.id, idempotencyKey);
  const fingerprint = requestFingerprint(input);

  const prior = await findPriorOrder(actor, key, fingerprint);

  if (prior) {
    return prior;
  }

  try {
    const orderId = await withTransaction((tx) => createOrder(tx, actor, key, fingerprint, input), {
      label: 'checkout.placeOrder',
    });

    return { order: await getOwnOrder(actor.id, orderId), replayed: false };
  } catch (error) {
    // A concurrent duplicate won the unique index. The lookup is by value rather than by the
    // violated column's name, which driver adapters do not report consistently.
    if (isUniqueViolation(error)) {
      const raced = await findPriorOrder(actor, key, fingerprint);

      if (raced) {
        return raced;
      }
    }

    throw error;
  }
}
