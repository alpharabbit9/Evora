import { type RequestHandler, Router, urlencoded } from 'express';
import { z } from 'zod';

import { env } from '../../config/env.js';
import { actorOf, requireAuth } from '../../http/guards.js';
import { route } from '../../http/route.js';
import { idParams } from '../../http/schemas.js';
import {
  getPaymentForViewer,
  handleBrowserReturn,
  handleProviderNotification,
  startPaymentSession,
} from './payments.service.js';

/**
 * Two kinds of caller, kept in separate routers because they are mounted differently (`app.ts`):
 *
 *  - The provider and the gateway's browser redirect. They are cross-site by nature, so they sit
 *    outside the Origin check, and form-encoded, so they have their own parser. They carry no
 *    session and rely on no cookie: a signature for the webhook, and for the return, nothing it
 *    says is believed.
 *  - The signed-in customer, who gets the ordinary protections.
 */

/**
 * `extended: false` parses with Node's `querystring`, so no nested objects. A repeated field comes
 * through as an array and is dropped here: a signed message has exactly one value per field.
 */
const formBody = urlencoded({ extended: false, limit: '32kb' });

function formFields(body: unknown): Record<string, string> {
  const fields: Record<string, string> = {};

  if (body && typeof body === 'object') {
    for (const [key, value] of Object.entries(body)) {
      if (typeof value === 'string') {
        fields[key] = value;
      }
    }
  }

  return fields;
}

export const paymentWebhookRouter = Router();

paymentWebhookRouter.post(
  '/:provider',
  formBody,
  route({
    params: z.object({ provider: z.string().min(1).max(40) }),
    handler: async ({ req, params }) => {
      const { duplicate } = await handleProviderNotification(params.provider, formFields(req.body));

      return { received: true, duplicate };
    },
  }),
);

const browserReturn: RequestHandler = async (req, res) => {
  const paymentId = z.string().min(1).max(64).safeParse(req.params.paymentId);
  const path = paymentId.success
    ? await handleBrowserReturn(paymentId.data, formFields(req.body))
    : '/account';

  // A fixed origin and a path built from our own ids, so this cannot become an open redirect. 303
  // turns the gateway's POST into a GET, which is also what makes the Lax session cookie go along.
  res.redirect(303, `${env.FRONTEND_ORIGIN}${path}`);
};

export const paymentReturnRouter = Router();

// The documentation does not say which method the gateway uses, so both are served.
paymentReturnRouter.post('/:paymentId', formBody, browserReturn);
paymentReturnRouter.get('/:paymentId', browserReturn);

export const paymentsRouter = Router();

paymentsRouter.use(requireAuth);

paymentsRouter.get(
  '/:paymentId',
  route({
    params: idParams('paymentId'),
    handler: ({ req, params }) => getPaymentForViewer(actorOf(req), params.paymentId),
  }),
);

/** Mounted beside the orders router; anything else under `/orders` falls through to it. */
export const orderPaymentRouter = Router();

orderPaymentRouter.post(
  '/:orderId/payment-session',
  requireAuth,
  route({
    params: idParams('orderId'),
    handler: ({ req, params }) => startPaymentSession(actorOf(req), params.orderId),
  }),
);
