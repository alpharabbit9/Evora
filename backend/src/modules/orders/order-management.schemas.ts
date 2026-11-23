import { OrderPaymentStatus, OrderStatus, PaymentMethod } from '@prisma/client';
import { z } from 'zod';

import { paginationQuery } from '../../http/schemas.js';

/**
 * Request shapes for order management (API_SPEC.md §6 and §8, ADR 0020). Every body is strict, so
 * a status, payment state or amount the caller may not set is a 400 rather than a dropped field.
 */
const note = (max: number) => z.string().trim().min(1).max(max);

/** The body is optional: `{}` or nothing at all. */
export const cancelOrderBody = z
  .strictObject({ reason: note(500).optional() })
  .optional()
  .transform((body) => body ?? {});

export const adminOrderListQuery = paginationQuery.extend({
  q: z.string().trim().min(1).max(120).optional(),
  status: z.enum(OrderStatus).optional(),
  paymentStatus: z.enum(OrderPaymentStatus).optional(),
  paymentMethod: z.enum(PaymentMethod).optional(),
});

export const adminTransitionBody = z
  .strictObject({
    /** The status the administrator was looking at. Refused if the order has moved since. */
    from: z.enum(OrderStatus),
    to: z.enum(OrderStatus),
    note: note(500).optional(),
    carrier: note(80).optional(),
    trackingNumber: note(120).optional(),
  })
  .refine(
    (body) =>
      body.to === 'SHIPPED' || (body.carrier === undefined && body.trackingNumber === undefined),
    { message: 'A carrier and tracking number belong only to shipping', path: ['carrier'] },
  );

export const adminRefundBody = z.strictObject({
  /** Minor units (poisha). What is still refundable is checked against the payment. */
  amountMinor: z.number().int().min(1),
  reason: note(255),
});

export const holdResolutionBody = z.strictObject({
  decision: z.enum(['accept', 'reject']),
  note: note(500),
});
