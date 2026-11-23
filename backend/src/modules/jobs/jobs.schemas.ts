import { OutboxEventType, OutboxStatus } from '@prisma/client';
import { z } from 'zod';

import { paginationQuery } from '../../http/schemas.js';

/** `GET /admin/jobs` (API_SPEC.md §8). Both filters are allow-listed against the enums. */
export const adminJobListQuery = paginationQuery.extend({
  status: z.enum(OutboxStatus).optional(),
  type: z.enum(OutboxEventType).optional(),
});

/**
 * `POST /admin/jobs/retry`: every DEAD job, or every DEAD job of one type, after an outage has
 * passed. Only DEAD is accepted: a FAILED job is already going to be retried.
 */
export const adminBulkRetryBody = z.strictObject({
  status: z.literal('DEAD'),
  type: z.enum(OutboxEventType).optional(),
});
