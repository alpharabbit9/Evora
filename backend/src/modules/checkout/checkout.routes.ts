import { Router } from 'express';

import { actorOf, requireAuth } from '../../http/guards.js';
import { created, respond, route } from '../../http/route.js';
import { idempotencyKey } from '../../http/schemas.js';
import { parseOrThrow } from '../../http/validation.js';
import { checkoutQuoteBody, placeOrderBody } from './checkout.schemas.js';
import { placeOrder, quoteCheckout } from './checkout.service.js';

/**
 * `/api/v1/checkout` (API_SPEC.md §6). Signed-in callers only: the cart belongs to an account
 * (ADR 0014) and guest checkout is not offered (ADR 0018).
 *
 * `201` for a new order and `200` with `meta.replayed` for a request that found one, so a client
 * or a log can tell the two apart while both carry the same order.
 */
export const checkoutRouter = Router();

checkoutRouter.use(requireAuth);

checkoutRouter.post(
  '/quote',
  route({
    body: checkoutQuoteBody,
    handler: ({ req, body }) => quoteCheckout(actorOf(req), body),
  }),
);

checkoutRouter.post(
  '/',
  route({
    body: placeOrderBody,
    handler: async ({ req, body }) => {
      const key = parseOrThrow(idempotencyKey, req.get('idempotency-key'), 'Idempotency-Key');
      const { order, replayed } = await placeOrder(actorOf(req), key, body);

      return replayed ? respond(order, { meta: { replayed: true } }) : created(order);
    },
  }),
);
