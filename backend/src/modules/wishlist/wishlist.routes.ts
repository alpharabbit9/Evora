import { Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { route } from '../../http/route.js';
import { wishlistItemParams } from './wishlist.schemas.js';
import { getWishlist, removeProduct, saveProduct } from './wishlist.service.js';

/**
 * `/api/v1/me/wishlist` (API_SPEC.md §3, ADR 0016). Signed-in customers only: `requireAuth`
 * is applied to the router, so a new endpoint added below is protected by default.
 *
 * Saving and removing are `PUT`/`DELETE` on the product's own path because both are
 * idempotent — repeating either leaves the same state — which is what a retried request or a
 * double-clicked heart needs. Every endpoint answers with the whole list, so the client
 * replaces its copy with the server's instead of patching it.
 */
export const wishlistRouter = Router();

wishlistRouter.use(requireAuth);

wishlistRouter.get(
  '/',
  route({
    handler: ({ req }) => getWishlist(actorOf(req).id),
  }),
);

wishlistRouter.put(
  '/items/:productId',
  route({
    params: wishlistItemParams,
    handler: async ({ req, params }) => {
      const userId = actorOf(req).id;
      await saveProduct(userId, params.productId);
      return getWishlist(userId);
    },
  }),
);

wishlistRouter.delete(
  '/items/:productId',
  route({
    params: wishlistItemParams,
    handler: async ({ req, params }) => {
      const userId = actorOf(req).id;
      await removeProduct(userId, params.productId);
      return getWishlist(userId);
    },
  }),
);
