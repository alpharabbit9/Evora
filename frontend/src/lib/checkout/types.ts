import type { CartLineStatus, ImageView } from '@/lib/catalog/types';

/**
 * Response shapes for `/checkout`, `/orders` and `/me/addresses` (API_SPEC.md §3 and §6). Every
 * amount here was computed by the server; the browser only displays them.
 */
export type DeliveryOptionId = 'standard' | 'express';

export type PaymentMethodId = 'COD' | 'ONLINE';

export interface DeliveryOption {
  readonly id: DeliveryOptionId;
  readonly label: string;
  readonly estimate: string;
  /** `null` until the address is known: the fee depends on it. */
  readonly feeMinor: number | null;
}

export interface CheckoutQuoteLine {
  readonly variantId: string;
  readonly quantity: number;
  readonly status: CartLineStatus;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly color: string | null;
  readonly size: string | null;
  readonly product: {
    readonly slug: string;
    readonly name: string;
    readonly brand: string | null;
    readonly image: ImageView | null;
  };
}

export interface CheckoutQuote {
  readonly currency: string;
  readonly items: readonly CheckoutQuoteLine[];
  readonly deliveryOptions: readonly DeliveryOption[];
  readonly deliveryOption: DeliveryOptionId;
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly taxMinor: number;
  readonly shippingMinor: number | null;
  readonly totalMinor: number | null;
  readonly paymentMethods: readonly PaymentMethodId[];
  readonly hasIssues: boolean;
  /** The code asked about, and whether it applies; `null` when none was entered. */
  readonly coupon: CouponQuote | null;
  /** Delivery is free once the discounted subtotal reaches this; `null` = never. */
  readonly freeShippingThresholdMinor: number | null;
}

export interface CouponQuote {
  readonly code: string;
  readonly status: 'applied' | 'refused';
  readonly discountMinor: number;
  /** Why it does not apply, worded for the customer. */
  readonly message: string | null;
}

export interface CheckoutItem {
  readonly variantId: string;
  readonly quantity: number;
}

export interface ShippingDetails {
  readonly recipientName: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly countryCode: string;
}

export interface PlaceOrderInput {
  readonly items: readonly CheckoutItem[];
  readonly shipping: ShippingDetails;
  readonly deliveryOption: DeliveryOptionId;
  readonly paymentMethod: PaymentMethodId;
  readonly saveAddress: boolean;
  /** Sent only when the quote said it applies. */
  readonly couponCode?: string;
  /** The total on screen. A guard the server checks, never what it charges. */
  readonly expectedTotalMinor: number;
}

export type OrderStatus =
  | 'PENDING_PAYMENT'
  | 'CONFIRMED'
  | 'PROCESSING'
  | 'SHIPPED'
  | 'DELIVERED'
  | 'CANCELLED'
  | 'PAYMENT_FAILED';

export type OrderPaymentStatus =
  | 'UNPAID'
  | 'PENDING'
  | 'PAID'
  | 'PARTIALLY_REFUNDED'
  | 'REFUNDED'
  | 'FAILED'
  | 'COD_PENDING'
  | 'COD_COLLECTED';

export interface OrderSummary {
  readonly id: string;
  readonly orderNumber: string;
  readonly status: OrderStatus;
  readonly paymentStatus: OrderPaymentStatus;
  readonly paymentMethod: PaymentMethodId;
  readonly currency: string;
  readonly totalMinor: number;
  readonly placedAt: string;
}

export interface OrderLine {
  readonly id: string;
  readonly productNameSnapshot: string;
  readonly skuSnapshot: string;
  readonly quantity: number;
  readonly color: string | null;
  readonly size: string | null;
  readonly unitPriceMinor: number;
  readonly lineTotalMinor: number;
  readonly image: ImageView | null;
}

export interface OrderDetail extends OrderSummary {
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly contact: { readonly email: string; readonly phone: string | null };
  readonly shipping: {
    readonly recipientName: string;
    readonly line1: string;
    readonly line2: string | null;
    readonly city: string;
    readonly state: string | null;
    readonly postalCode: string;
    readonly countryCode: string;
    readonly method: string | null;
  };
  readonly items: readonly OrderLine[];
  /** The online payment attempt. `null` for cash on delivery. */
  readonly payment: {
    readonly id: string;
    readonly status:
      | 'PENDING'
      | 'PROCESSING'
      | 'SUCCEEDED'
      | 'FAILED'
      | 'CANCELLED'
      | 'PARTIALLY_REFUNDED'
      | 'REFUNDED';
    readonly canResume: boolean;
  } | null;
  /** Oldest first. */
  readonly timeline: readonly { readonly status: OrderStatus; readonly at: string }[];
  readonly tracking: { readonly carrier: string | null; readonly number: string | null } | null;
  readonly refunds: readonly {
    readonly id: string;
    readonly amountMinor: number;
    readonly status: RefundStatus;
    readonly createdAt: string;
  }[];
  /** Whether the customer may cancel it themselves now. The server decides; this only shows it. */
  readonly canCancel: boolean;
}

export type RefundStatus = 'PENDING' | 'SUCCEEDED' | 'FAILED';

export interface SavedAddress {
  readonly id: string;
  readonly label: string | null;
  readonly recipientName: string;
  readonly phone: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly countryCode: string;
  readonly isDefault: boolean;
}
