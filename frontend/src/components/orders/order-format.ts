import type { OrderPaymentStatus, OrderStatus, RefundStatus } from '@/lib/checkout/types';

/** How order states read to a customer. Written as total records, so a new state is a type error. */
export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  PENDING_PAYMENT: 'Awaiting payment',
  CONFIRMED: 'Confirmed',
  PROCESSING: 'Being prepared',
  SHIPPED: 'On its way',
  DELIVERED: 'Delivered',
  CANCELLED: 'Cancelled',
  PAYMENT_FAILED: 'Payment failed',
};

export const PAYMENT_STATUS_LABEL: Record<OrderPaymentStatus, string> = {
  UNPAID: 'Not paid',
  PENDING: 'Payment pending',
  PAID: 'Paid',
  PARTIALLY_REFUNDED: 'Partly refunded',
  REFUNDED: 'Refunded',
  FAILED: 'Payment failed',
  COD_PENDING: 'Pay on delivery',
  COD_COLLECTED: 'Paid on delivery',
};

export const REFUND_STATUS_LABEL: Record<RefundStatus, string> = {
  PENDING: 'On its way back to you',
  SUCCEEDED: 'Refunded',
  FAILED: 'Could not be completed; we are looking into it',
};

/** The steps a delivered order passes through, in order, for the progress list. */
export const FULFILMENT_STEPS: readonly OrderStatus[] = [
  'CONFIRMED',
  'PROCESSING',
  'SHIPPED',
  'DELIVERED',
];

export const DELIVERY_METHOD_LABEL: Record<string, string> = {
  standard: 'Standard delivery',
  express: 'Express delivery',
};

const dateFormatter = new Intl.DateTimeFormat('en-GB', { dateStyle: 'long' });

export function formatOrderDate(iso: string): string {
  return dateFormatter.format(new Date(iso));
}
