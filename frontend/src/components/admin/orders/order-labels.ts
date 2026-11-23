import type { OrderPaymentStatus, OrderStatus } from '@/lib/checkout/types';

import type { Badge } from '../admin-ui';

type Tone = NonNullable<React.ComponentProps<typeof Badge>['tone']>;

/** An operator's words for an order's state, which are blunter than the customer's. */
export const ORDER_STATUS_ADMIN: Record<OrderStatus, { label: string; tone: Tone }> = {
  PENDING_PAYMENT: { label: 'Awaiting payment', tone: 'warning' },
  CONFIRMED: { label: 'To prepare', tone: 'neutral' },
  PROCESSING: { label: 'Preparing', tone: 'neutral' },
  SHIPPED: { label: 'Shipped', tone: 'neutral' },
  DELIVERED: { label: 'Delivered', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'destructive' },
  PAYMENT_FAILED: { label: 'Payment failed', tone: 'destructive' },
};

export const ORDER_PAYMENT_ADMIN: Record<OrderPaymentStatus, { label: string; tone: Tone }> = {
  UNPAID: { label: 'Unpaid', tone: 'neutral' },
  PENDING: { label: 'Payment pending', tone: 'warning' },
  PAID: { label: 'Paid', tone: 'success' },
  PARTIALLY_REFUNDED: { label: 'Partly refunded', tone: 'warning' },
  REFUNDED: { label: 'Refunded', tone: 'neutral' },
  FAILED: { label: 'Failed', tone: 'destructive' },
  COD_PENDING: { label: 'Cash due', tone: 'warning' },
  COD_COLLECTED: { label: 'Cash collected', tone: 'success' },
};

/** The button for moving an order on, phrased as the thing that happened. */
export const TRANSITION_ACTION: Partial<Record<OrderStatus, string>> = {
  PROCESSING: 'Start preparing',
  SHIPPED: 'Mark as shipped',
  DELIVERED: 'Mark as delivered',
  CANCELLED: 'Cancel order',
};
