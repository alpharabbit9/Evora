import { type Request, type Response, Router } from 'express';

import { notFound } from '../../http/errors.js';
import { withActor } from '../../http/guards.js';
import { route } from '../../http/route.js';
import { addCartItemBody, cartItemParams, updateCartItemBody } from './cart.schemas.js';
import {
  type CartOwner,
  addItem,
  emptyCart,
  getCart,
  hasActiveCart,
  mergeGuestCart,
  removeItem,
  updateItem,
} from './cart.service.js';
import { clearGuestToken, issueGuestToken, readGuestTokenHash } from './guest-token.js';

/**
 * `/api/v1/cart` (API_SPEC.md §5). Open to signed-in and anonymous callers; the owner is
 * derived per request from the verified session or the httpOnly guest cookie — never from a
 * user id, cart id or token in the URL or body.
 *
 * Every endpoint answers with the whole cart, re-priced from the catalog, so the client
 * never has to compute a total itself.
 *
 * Merge: a signed-in caller who still carries a guest cookie (they shopped, then signed in)
 * has the guest cart folded into their account cart on their next cart request, and the
 * cookie is cleared. That includes `GET`, which therefore writes: both carts belong to the
 * caller, and the merge is idempotent (`mergeGuestCart`), so a repeated or cross-site-
 * triggered GET can only do what the customer's own next request would have done anyway.
 * This replaces API_SPEC.md's separate `POST /cart/merge`: the frontend cannot see the
 * httpOnly cookie, so it could never know when to call it.
 */
export const cartRouter = Router();

cartRouter.use(withActor);

async function currentOwner(req: Request, res: Response): Promise<CartOwner | undefined> {
  const guestTokenHash = readGuestTokenHash(req);

  if (req.actor) {
    if (guestTokenHash) {
      await mergeGuestCart(req.actor.id, guestTokenHash);
      clearGuestToken(res);
    }
    return { kind: 'user', userId: req.actor.id };
  }

  return guestTokenHash ? { kind: 'guest', tokenHash: guestTokenHash } : undefined;
}

/** For writes on existing lines: no cart means the line cannot be the caller's. */
async function requireOwner(req: Request, res: Response): Promise<CartOwner> {
  const owner = await currentOwner(req, res);

  if (!owner) {
    throw notFound('That item is not in your bag.');
  }

  return owner;
}

cartRouter.get(
  '/',
  route({
    handler: async ({ req, res }) => {
      const owner = await currentOwner(req, res);
      return owner ? getCart(owner) : emptyCart();
    },
  }),
);

cartRouter.post(
  '/items',
  route({
    body: addCartItemBody,
    handler: async ({ req, res, body }) => {
      let owner = await currentOwner(req, res);

      // A first-time guest, or one whose cart expired or was merged away, gets a new token.
      // The cookie is only set on a request that is about to create a cart.
      if (!owner || (owner.kind === 'guest' && !(await hasActiveCart(owner)))) {
        owner = { kind: 'guest', tokenHash: issueGuestToken(res) };
      }

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
      const owner = await requireOwner(req, res);
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
      const owner = await requireOwner(req, res);
      await removeItem(owner, params.itemId);
      return getCart(owner);
    },
  }),
);
