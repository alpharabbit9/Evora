import { Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { paged, route } from '../../http/route.js';
import { idParams, pageMeta, paginationQuery } from '../../http/schemas.js';
import { getOwnOrder, listOwnOrders } from './orders.service.js';

/**
 * A customer's own orders (API_SPEC.md §6). Read-only: checkout is M6 and fulfilment
 * transitions are M8.
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
