import { Router } from 'express';

import { adminRouter } from '../../modules/admin/admin.routes.js';
import { cartRouter } from '../../modules/cart/cart.routes.js';
import { categoriesRouter, productsRouter } from '../../modules/catalog/catalog.routes.js';
import { meRouter } from '../../modules/identity/identity.routes.js';
import { ordersRouter } from '../../modules/orders/orders.routes.js';

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
// Session or guest token: ownership is resolved per request inside the cart module.
apiRouter.use('/cart', cartRouter);
apiRouter.use('/me', meRouter);
apiRouter.use('/orders', ordersRouter);
apiRouter.use('/admin', adminRouter);
