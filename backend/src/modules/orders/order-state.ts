import type { OrderStatus } from '@prisma/client';

/**
 * The order lifecycle (API_SPEC.md §9, ADR 0020), as data. Payment moves an order out of
 * `PENDING_PAYMENT` (ADR 0019); everything after that is a person deciding, and this table is what
 * they may decide. Anything not listed is refused, so a new status is closed until someone adds it.
 *
 * Fulfilment only moves forward. Nothing comes back from `SHIPPED`: once goods have left, undoing
 * it is a return, which is a refund, not a status.
 */
export const ADMIN_TRANSITIONS: Readonly<Record<OrderStatus, readonly OrderStatus[]>> = {
  PENDING_PAYMENT: ['CANCELLED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED'],
  PROCESSING: ['SHIPPED', 'CANCELLED'],
  SHIPPED: ['DELIVERED'],
  DELIVERED: [],
  CANCELLED: [],
  PAYMENT_FAILED: [],
};

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return ADMIN_TRANSITIONS[from].includes(to);
}

/**
 * A customer may cancel until the store starts preparing the order: nothing has been picked or
 * packed, so nothing is lost by it. After that, only an administrator can (provisional policy,
 * PRD §9).
 */
const CUSTOMER_CANCELLABLE: ReadonlySet<OrderStatus> = new Set(['PENDING_PAYMENT', 'CONFIRMED']);

export function canCustomerCancel(status: OrderStatus): boolean {
  return CUSTOMER_CANCELLABLE.has(status);
}

/** Statuses after which an order is closed for good. */
export const CLOSED_STATUSES: ReadonlySet<OrderStatus> = new Set([
  'CANCELLED',
  'PAYMENT_FAILED',
  'DELIVERED',
]);
