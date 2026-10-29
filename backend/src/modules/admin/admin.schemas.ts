import { UserRole, UserStatus } from '@prisma/client';
import { z } from 'zod';

import { paginationQuery } from '../../http/schemas.js';

/**
 * Admin request shapes (API_SPEC.md §8).
 *
 * `role` and `status` are allow-listed against the Prisma enums, so an unknown value is a
 * 400 before any query runs and the database never sees an invalid enum member. Both
 * bodies are strict: a request that also tries to set, say, `emailVerified` is refused
 * rather than partially honoured.
 */
export const customerListQuery = paginationQuery.extend({
  /** Free-text match on email and name. Bound as a parameter, never interpolated. */
  q: z.string().trim().min(1).max(120).optional(),
  role: z.enum(UserRole).optional(),
  status: z.enum(UserStatus).optional(),
});

export type CustomerListQuery = z.output<typeof customerListQuery>;

export const updateCustomerStatusBody = z.strictObject({
  status: z.enum(UserStatus),
});

export const updateCustomerRoleBody = z.strictObject({
  role: z.enum(UserRole),
});
