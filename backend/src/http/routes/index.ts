import { Router } from 'express';

import { adminRouter } from '../../modules/admin/admin.routes.js';
import { assistantRouter } from '../../modules/assistant/assistant.routes.js';
import { cartRouter } from '../../modules/cart/cart.routes.js';
import {
  categoriesRouter,
  productsRouter,
  searchRouter,
} from '../../modules/catalog/catalog.routes.js';
import { checkoutRouter } from '../../modules/checkout/checkout.routes.js';
import { meRouter } from '../../modules/identity/identity.routes.js';
import { ordersRouter } from '../../modules/orders/orders.routes.js';
import { orderPaymentRouter, paymentsRouter } from '../../modules/payments/payments.routes.js';
import { wishlistRouter } from '../../modules/wishlist/wishlist.routes.js';

/**
 * The application's own routes, everything under `/api/v1` except health and the Better
 * Auth subtree (those are mounted in `src/app.ts`, which has to put the auth handler ahead
 * of the JSON body parser).
 *
 * Each sub-router carries its own guard, applied with `router.use`, so authorization is a
 * property of the subtree rather than of individual endpoints.
 */
export const apiRouter = Router();

// Public: the publication rule inside each query is what keeps drafts out (catalog module).
apiRouter.use('/products', productsRouter);
apiRouter.use('/categories', categoriesRouter);
apiRouter.use('/search', searchRouter);
// Session required (ADR 0014): the cart module applies `requireAuth` to its own router.
apiRouter.use('/cart', cartRouter);
apiRouter.use('/checkout', checkoutRouter);
// Ahead of `/me` so it is matched first; it carries its own `requireAuth` (ADR 0016).
apiRouter.use('/me/wishlist', wishlistRouter);
apiRouter.use('/me', meRouter);
// Ahead of the orders router, whose `requireAuth` would otherwise be the only thing in the way.
apiRouter.use('/orders', orderPaymentRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/payments', paymentsRouter);
apiRouter.use('/admin', adminRouter);
// Guests and customers (ADR 0025): `withActor` on the router; order tools need a session.
apiRouter.use('/assistant', assistantRouter);
