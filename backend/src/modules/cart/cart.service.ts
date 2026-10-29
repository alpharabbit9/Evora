import type { Prisma } from '@prisma/client';
import { CartStatus } from '@prisma/client';

import { env } from '../../config/env.js';
import { conflict, notFound, outOfStock, validationFailed } from '../../http/errors.js';
import { type ImageView, toImageView } from '../../lib/media.js';
import { prisma } from '../../lib/prisma.js';
import { type TransactionClient, withTransaction } from '../../lib/transaction.js';
import { PURCHASABLE_VARIANT_WHERE, publicProductWhere } from '../catalog/publication.js';
import { readOption } from '../catalog/sizes.js';
import {
  type AddCartItemInput,
  MAX_CART_LINES,
  MAX_LINE_QUANTITY,
  type UpdateCartItemInput,
} from './cart.schemas.js';
import { GUEST_CART_TTL_MS } from './guest-token.js';

/**
 * Cart (API_SPEC.md §5, implementation-plan.md M5 — the persistence and ownership half).
 *
 * Ownership: every query is scoped by the owner — the session's user id, or the hash of the
 * caller's guest token — as well as by the cart/line id. A line in someone else's cart
 * matches nothing and answers 404, so there is no separate ownership check to forget
 * (invariant 7, same pattern as addresses).
 *
 * Trust: the client sends a variant id and a quantity. Whether the variant can be sold, its
 * price and its stock are read from PostgreSQL on every request, and the cart stores no price
 * at all — a cart always shows today's price (CLAUDE.md: never trust client price or stock).
 *
 * The cart is advisory. Stock is checked when a line is added or raised, but not reserved:
 * ADR 0004 (decrement vs reservation) is still open, and checkout (M6) must re-validate price
 * and stock inside its own transaction regardless of what the cart said.
 */

export type CartOwner =
  | { readonly kind: 'user'; readonly userId: string }
  | { readonly kind: 'guest'; readonly tokenHash: string };

/**
 * `available` — can be bought at this quantity now.
 * `insufficient_stock` — in stock, but not this many.
 * `out_of_stock` — none left.
 * `unavailable` — unpublished, archived or otherwise no longer sold.
 */
export type CartLineStatus = 'available' | 'insufficient_stock' | 'out_of_stock' | 'unavailable';

export interface CartLineView {
  readonly id: string;
  readonly quantity: number;
  readonly status: CartLineStatus;
  /** Current price from the catalog, never a stored or client value. */
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly variant: {
    readonly id: string;
    readonly sku: string;
    readonly color: string | null;
    readonly size: string | null;
  };
  readonly product: {
    readonly slug: string;
    readonly name: string;
    readonly brand: string | null;
    readonly image: ImageView | null;
  };
}

export interface CartView {
  /** `null` until the first item is added; reading a cart never creates one. */
  readonly id: string | null;
  readonly currency: string;
  readonly items: readonly CartLineView[];
  /** Sum of quantities across all lines, for the header badge. */
  readonly itemCount: number;
  /** Sum of `available` lines only. An estimate: checkout recomputes it (API_SPEC.md §5). */
  readonly subtotalMinor: number;
  /** True when any line is not `available` and needs the customer's attention. */
  readonly hasIssues: boolean;
}

export function emptyCart(): CartView {
  return {
    id: null,
    currency: env.STORE_CURRENCY,
    items: [],
    itemCount: 0,
    subtotalMinor: 0,
    hasIssues: false,
  };
}

function guestExpiry(): Date {
  return new Date(Date.now() + GUEST_CART_TTL_MS);
}

/** The owner's current cart. Expired guest carts are treated as gone. */
function ownerWhere(owner: CartOwner): Prisma.CartWhereInput {
  if (owner.kind === 'user') {
    return { userId: owner.userId, status: CartStatus.ACTIVE };
  }

  return {
    guestTokenHash: owner.tokenHash,
    status: CartStatus.ACTIVE,
    OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
  };
}

export async function hasActiveCart(owner: CartOwner): Promise<boolean> {
  const cart = await prisma.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });
  return cart !== null;
}

/**
 * Find-or-create without a race: `carts_one_active_per_user_key` (and the unique guest token
 * hash) allow one active cart per owner, and `createMany({ skipDuplicates })` is
 * `INSERT ... ON CONFLICT DO NOTHING`, so two concurrent first adds both end up reading the
 * same row instead of one of them failing.
 */
async function findOrCreateCartId(tx: TransactionClient, owner: CartOwner): Promise<string> {
  const existing = await tx.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });

  if (existing) {
    if (owner.kind === 'guest') {
      await tx.cart.update({ where: { id: existing.id }, data: { expiresAt: guestExpiry() } });
    }
    return existing.id;
  }

  await tx.cart.createMany({
    data: [
      owner.kind === 'user'
        ? { userId: owner.userId }
        : { guestTokenHash: owner.tokenHash, expiresAt: guestExpiry() },
    ],
    skipDuplicates: true,
  });

  const created = await tx.cart.findFirst({ where: ownerWhere(owner), select: { id: true } });

  if (!created) {
    // Only possible if the guest hash belongs to an expired row; the route issues a fresh
    // token in that case, so reaching this is a bug rather than a user error.
    throw new Error('Cart could not be created for this owner');
  }

  return created.id;
}

function itemUnavailable(): never {
  throw notFound('That item is not available.');
}

function tooMany(): never {
  throw validationFailed(
    [{ field: 'quantity', issue: `At most ${MAX_LINE_QUANTITY} of an item per order.` }],
    `You can add at most ${MAX_LINE_QUANTITY} of an item.`,
  );
}

/**
 * Adds `quantity` of a variant, or raises the existing line by it.
 *
 * The increment is a single atomic upsert (`INSERT ... ON CONFLICT DO UPDATE SET quantity =
 * quantity + n`), so two concurrent adds of the same item both count. The limits are checked
 * on the resulting row, and exceeding one throws inside the transaction, which rolls the
 * increment back.
 */
export async function addItem(owner: CartOwner, input: AddCartItemInput): Promise<void> {
  await withTransaction(
    async (tx) => {
      const variant = await tx.productVariant.findFirst({
        where: { id: input.variantId, ...PURCHASABLE_VARIANT_WHERE, product: publicProductWhere() },
        select: { id: true, stockQuantity: true },
      });

      if (!variant) {
        itemUnavailable();
      }

      if (variant.stockQuantity <= 0) {
        throw outOfStock('This item is sold out.');
      }

      const cartId = await findOrCreateCartId(tx, owner);

      const existing = await tx.cartItem.findUnique({
        where: { cartId_variantId: { cartId, variantId: variant.id } },
        select: { id: true },
      });

      if (!existing && (await tx.cartItem.count({ where: { cartId } })) >= MAX_CART_LINES) {
        throw conflict(`Your bag can hold up to ${MAX_CART_LINES} different items.`);
      }

      const line = await tx.cartItem.upsert({
        where: { cartId_variantId: { cartId, variantId: variant.id } },
        create: { cartId, variantId: variant.id, quantity: input.quantity },
        update: { quantity: { increment: input.quantity } },
        select: { quantity: true },
      });

      if (line.quantity > MAX_LINE_QUANTITY) {
        tooMany();
      }

      if (line.quantity > variant.stockQuantity) {
        throw outOfStock('There is not enough stock for that quantity.');
      }
    },
    { label: 'cart.addItem' },
  );
}

/**
 * Sets a line's quantity. Lowering is always allowed — it is how a customer resolves an
 * `insufficient_stock` line — but raising is checked against current stock.
 */
export async function updateItem(
  owner: CartOwner,
  itemId: string,
  input: UpdateCartItemInput,
): Promise<void> {
  await withTransaction(
    async (tx) => {
      const line = await tx.cartItem.findFirst({
        where: { id: itemId, cart: ownerWhere(owner) },
        select: { id: true, quantity: true, variantId: true },
      });

      if (!line) {
        throw notFound('That item is not in your bag.');
      }

      if (input.quantity > line.quantity) {
        const variant = await tx.productVariant.findFirst({
          where: {
            id: line.variantId,
            ...PURCHASABLE_VARIANT_WHERE,
            product: publicProductWhere(),
          },
          select: { stockQuantity: true },
        });

        if (!variant) {
          throw conflict('This item is no longer available. Remove it from your bag.');
        }

        if (input.quantity > variant.stockQuantity) {
          throw outOfStock('There is not enough stock for that quantity.');
        }
      }

      await tx.cartItem.update({ where: { id: line.id }, data: { quantity: input.quantity } });
    },
    { label: 'cart.updateItem' },
  );
}

export async function removeItem(owner: CartOwner, itemId: string): Promise<void> {
  // Scoped delete: a line in another cart is simply not matched.
  const { count } = await prisma.cartItem.deleteMany({
    where: { id: itemId, cart: ownerWhere(owner) },
  });

  if (count === 0) {
    throw notFound('That item is not in your bag.');
  }
}

/**
 * Moves a guest cart into the signed-in user's cart, then deletes the guest cart.
 *
 * Quantities of the same variant are added and capped at the per-line maximum; lines beyond
 * the cart's line limit are dropped. Stock is not enforced here — the merged cart reports
 * any line that cannot be bought as it stands.
 *
 * Idempotent under concurrency: the guest cart is deleted with a conditional `deleteMany`
 * before anything is copied, so of two simultaneous merges (two tabs) only the one whose
 * delete matched a row copies items; the other sees `count === 0` and stops.
 */
export async function mergeGuestCart(userId: string, guestTokenHash: string): Promise<void> {
  await withTransaction(
    async (tx) => {
      const guest = await tx.cart.findFirst({
        where: ownerWhere({ kind: 'guest', tokenHash: guestTokenHash }),
        select: { id: true, items: { select: { variantId: true, quantity: true } } },
      });

      if (!guest) {
        return;
      }

      const { count } = await tx.cart.deleteMany({
        where: { id: guest.id, status: CartStatus.ACTIVE },
      });

      if (count === 0 || guest.items.length === 0) {
        return;
      }

      const cartId = await findOrCreateCartId(tx, { kind: 'user', userId });
      const current = await tx.cartItem.findMany({
        where: { cartId },
        select: { variantId: true, quantity: true },
      });
      const quantities = new Map(current.map((line) => [line.variantId, line.quantity]));
      let lines = current.length;

      for (const item of guest.items) {
        const existing = quantities.get(item.variantId);

        if (existing === undefined) {
          if (lines >= MAX_CART_LINES) continue;
          lines += 1;
          await tx.cartItem.create({
            data: {
              cartId,
              variantId: item.variantId,
              quantity: Math.min(item.quantity, MAX_LINE_QUANTITY),
            },
          });
          continue;
        }

        await tx.cartItem.update({
          where: { cartId_variantId: { cartId, variantId: item.variantId } },
          data: { quantity: Math.min(existing + item.quantity, MAX_LINE_QUANTITY) },
        });
      }
    },
    { label: 'cart.mergeGuest' },
  );
}

const CART_SELECT = {
  id: true,
  items: {
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      quantity: true,
      variant: {
        select: {
          id: true,
          sku: true,
          options: true,
          priceMinor: true,
          stockQuantity: true,
          product: {
            select: {
              slug: true,
              name: true,
              brand: true,
              images: {
                orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
                take: 1,
                select: { objectKey: true, altText: true, widthPx: true, heightPx: true },
              },
            },
          },
        },
      },
    },
  },
} satisfies Prisma.CartSelect;

function lineStatus(purchasable: boolean, stock: number, quantity: number): CartLineStatus {
  if (!purchasable) return 'unavailable';
  if (stock <= 0) return 'out_of_stock';
  if (quantity > stock) return 'insufficient_stock';
  return 'available';
}

/** The owner's cart, priced and checked against the catalog as it is right now. */
export async function getCart(owner: CartOwner): Promise<CartView> {
  const cart = await prisma.cart.findFirst({ where: ownerWhere(owner), select: CART_SELECT });

  if (!cart) {
    return emptyCart();
  }

  const variantIds = cart.items.map((item) => item.variant.id);

  // The same publication rule the catalog uses, evaluated for every line in one query.
  const purchasable = new Set(
    (
      await prisma.productVariant.findMany({
        where: {
          id: { in: variantIds },
          ...PURCHASABLE_VARIANT_WHERE,
          product: publicProductWhere(),
        },
        select: { id: true },
      })
    ).map((variant) => variant.id),
  );

  const items: CartLineView[] = cart.items.map((item) => {
    const { variant } = item;
    const image = variant.product.images[0];

    return {
      id: item.id,
      quantity: item.quantity,
      status: lineStatus(purchasable.has(variant.id), variant.stockQuantity, item.quantity),
      unitPriceMinor: variant.priceMinor,
      lineTotalMinor: variant.priceMinor * item.quantity,
      variant: {
        id: variant.id,
        sku: variant.sku,
        color: readOption(variant.options, 'color'),
        size: readOption(variant.options, 'size'),
      },
      product: {
        slug: variant.product.slug,
        name: variant.product.name,
        brand: variant.product.brand,
        image: image ? toImageView(image) : null,
      },
    };
  });

  return {
    id: cart.id,
    currency: env.STORE_CURRENCY,
    items,
    itemCount: items.reduce((sum, item) => sum + item.quantity, 0),
    subtotalMinor: items
      .filter((item) => item.status === 'available')
      .reduce((sum, item) => sum + item.lineTotalMinor, 0),
    hasIssues: items.some((item) => item.status !== 'available'),
  };
}
