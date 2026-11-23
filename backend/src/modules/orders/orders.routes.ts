import { Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { paged, route } from '../../http/route.js';
import { idParams, pageMeta, paginationQuery } from '../../http/schemas.js';
import { cancelOrderBody } from './order-management.schemas.js';
import { cancelOwnOrder } from './order-management.service.js';
import { getOwnOrder, listOwnOrders } from './orders.service.js';

/**
 * A customer's own orders (API_SPEC.md §6). Orders are created by the checkout module; the one
 * change a customer makes here is cancelling (ADR 0020).
 *
 * `requireAuth` on the router, and both handlers pass `actorOf(req).id` into the query, so
 * the subject of the read is the session's user and nothing else.
 */
export const ordersRouter = Router();

ordersRouter.use(requireAuth);

ordersRouter.get(
  '/',
  route({
    query: paginationQuery,
    handler: async ({ req, query }) => {
      const { items, total } = await listOwnOrders(actorOf(req).id, query);
      return paged(items, pageMeta(query, total));
    },
  }),
);

ordersRouter.get(
  '/:orderId',
  route({
    params: idParams('orderId'),
    handler: ({ req, params }) => getOwnOrder(actorOf(req).id, params.orderId),
  }),
);

ordersRouter.post(
  '/:orderId/cancel',
  route({
    params: idParams('orderId'),
    body: cancelOrderBody,
    handler: ({ req, params, body }) => cancelOwnOrder(actorOf(req), params.orderId, body.reason),
  }),
);
