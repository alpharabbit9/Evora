import { z } from 'zod';

import { idParams, opaqueId } from '../../http/schemas.js';

/**
 * Request shapes for the cart (API_SPEC.md §5).
 *
 * A line is identified by a variant id and a quantity — nothing else. There is no price,
 * total, stock level or product name in any cart body: those are read from the database on
 * every request (CLAUDE.md: never trust client-provided price or stock). `strictObject`
 * turns an attempt to send one into a 400 instead of a silently ignored field.
 */

/**
 * Per-line cap. A service policy, deliberately far below the 1..999 CHECK on
 * `cart_items.quantity`, which is only the database's sanity range.
 */
export const MAX_LINE_QUANTITY = 10;

/** Distinct lines per cart. Bounds the work a single cart read can cause. */
export const MAX_CART_LINES = 50;

const quantity = z.coerce.number().int().min(1).max(MAX_LINE_QUANTITY);

export const addCartItemBody = z.strictObject({
  variantId: opaqueId,
  quantity: quantity.default(1),
});

export type AddCartItemInput = z.output<typeof addCartItemBody>;

export const updateCartItemBody = z.strictObject({ quantity });

export type UpdateCartItemInput = z.output<typeof updateCartItemBody>;

export const cartItemParams = idParams('itemId');
