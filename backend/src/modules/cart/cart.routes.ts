import { type Request, type Response, Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { route } from '../../http/route.js';
import { addCartItemBody, cartItemParams, updateCartItemBody } from './cart.schemas.js';
import {
  type CartOwner,
  addItem,
  getCart,
  mergeGuestCart,
  removeItem,
  updateItem,
} from './cart.service.js';
import { clearGuestToken, readGuestTokenHash } from './guest-token.js';

/**
 * `/api/v1/cart` (API_SPEC.md §5). Signed-in callers only (ADR 0014): `requireAuth` is applied
 * to the router, so an anonymous request is refused with 401 before it can read, create or
 * change a cart. The owner is the verified session's user — never a user id, cart id or token
 * in the URL or body.
 *
 * Every endpoint answers with the whole cart, re-priced from the catalog, so the client
 * never has to compute a total itself.
 *
 * Merge: guest carts can no longer be created, but ones made before ADR 0014 may still be
 * live (30-day expiry). A signed-in caller who still carries a guest cookie has that cart
 * folded into their account cart on their next cart request, and the cookie is cleared. That
 * includes `GET`, which therefore writes: both carts belong to the caller, and the merge is
 * idempotent (`mergeGuestCart`), so a repeated or cross-site-triggered GET can only do what
 * the customer's own next request would have done anyway. This replaces API_SPEC.md's
 * separate `POST /cart/merge`: the frontend cannot see the httpOnly cookie, so it could never
 * know when to call it.
 */
export const cartRouter = Router();

cartRouter.use(requireAuth);

async function accountOwner(req: Request, res: Response): Promise<CartOwner> {
  const userId = actorOf(req).id;
  const guestTokenHash = readGuestTokenHash(req);

  if (guestTokenHash) {
    await mergeGuestCart(userId, guestTokenHash);
    clearGuestToken(res);
  }

  return { kind: 'user', userId };
}

cartRouter.get(
  '/',
  route({
    handler: async ({ req, res }) => getCart(await accountOwner(req, res)),
  }),
);

cartRouter.post(
  '/items',
  route({
    body: addCartItemBody,
    handler: async ({ req, res, body }) => {
      const owner = await accountOwner(req, res);
      await addItem(owner, body);
      return getCart(owner);
    },
  }),
);

cartRouter.patch(
  '/items/:itemId',
  route({
    params: cartItemParams,
    body: updateCartItemBody,
    handler: async ({ req, res, params, body }) => {
      const owner = await accountOwner(req, res);
      await updateItem(owner, params.itemId, body);
      return getCart(owner);
    },
  }),
);

cartRouter.delete(
  '/items/:itemId',
  route({
    params: cartItemParams,
    handler: async ({ req, res, params }) => {
      const owner = await accountOwner(req, res);
      await removeItem(owner, params.itemId);
      return getCart(owner);
    },
  }),
);
