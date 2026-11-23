import { idParams } from '../../http/schemas.js';

/**
 * Request shapes for the wishlist (API_SPEC.md §3, ADR 0016).
 *
 * The only input is a product id in the path. Saving needs no body — there is nothing about a
 * saved product the client could usefully state — so the routes declare none.
 */

/**
 * Saved products per customer. Bounds the list read and the catalog query behind it, which is
 * why the list is returned whole rather than paginated. A service policy, checked before each
 * new save; two concurrent saves at the limit can both pass, which is acceptable for a bound
 * that protects resources rather than money or stock.
 */
export const MAX_WISHLIST_ITEMS = 100;

export const wishlistItemParams = idParams('productId');
