'use client';

import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiGet, apiGetPage, apiPost, newIdempotencyKey } from '@/lib/api-client';
import { cartKey } from '@/lib/cart/use-cart';

import type {
  CheckoutItem,
  CheckoutQuote,
  DeliveryOptionId,
  OrderDetail,
  OrderSummary,
  PlaceOrderInput,
  SavedAddress,
} from './types';

/**
 * Checkout and orders, as the API reports them (API_SPEC.md §6). Personalised and price
 * sensitive, so nothing here outlives the session or reaches a shared cache.
 */
const QUOTE_KEY = 'checkout-quote';
const ORDERS_KEY = 'orders';

export interface QuoteInput {
  readonly items: readonly CheckoutItem[];
  /** Without one the items are priced but delivery and the total stay open. */
  readonly destination: { readonly city: string; readonly countryCode: string } | null;
  readonly deliveryOption: DeliveryOptionId;
  /** A promo code to price with; the quote says whether it applies. */
  readonly couponCode?: string | undefined;
}

/**
 * Re-priced on every change and never treated as fresh: the total it returns is what the
 * customer agrees to. The previous quote stays on screen while the next one loads, and the form
 * holds its submit button until they match.
 */
export function useCheckoutQuote(input: QuoteInput) {
  return useQuery({
    queryKey: [QUOTE_KEY, input],
    queryFn: () =>
      apiPost<CheckoutQuote>('/checkout/quote', {
        body: {
          items: input.items,
          deliveryOption: input.deliveryOption,
          ...(input.destination ? { destination: input.destination } : {}),
          ...(input.couponCode ? { couponCode: input.couponCode } : {}),
        },
      }),
    staleTime: 0,
    placeholderData: keepPreviousData,
  });
}

const ATTEMPT_KEY_STORAGE = 'commercecore.checkout.attempt';

/**
 * One key per attempt to buy, kept until an order comes back rather than per click. A response
 * lost to a dropped connection or a reload therefore retries as the same request, and the server
 * answers with the order it already made instead of making a second one (invariant 5).
 *
 * `sessionStorage` is a best effort, and can throw. Without it the key lasts as long as the page.
 */
let memoryAttemptKey: string | undefined;

function attemptKey(): string {
  try {
    const stored = sessionStorage.getItem(ATTEMPT_KEY_STORAGE);
    if (stored) return stored;

    const created = newIdempotencyKey();
    sessionStorage.setItem(ATTEMPT_KEY_STORAGE, created);
    return created;
  } catch {
    memoryAttemptKey ??= newIdempotencyKey();
    return memoryAttemptKey;
  }
}

export function clearAttemptKey(): void {
  memoryAttemptKey = undefined;

  try {
    sessionStorage.removeItem(ATTEMPT_KEY_STORAGE);
  } catch {
    // Nothing stored, then.
  }
}

export function usePlaceOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: PlaceOrderInput) =>
      apiPost<OrderDetail>('/checkout', { body: input, idempotencyKey: attemptKey() }),
    onSuccess: (order) => {
      clearAttemptKey();
      queryClient.setQueryData([ORDERS_KEY, 'detail', order.id], order);
      void queryClient.invalidateQueries({ queryKey: cartKey });
      void queryClient.invalidateQueries({ queryKey: [ORDERS_KEY, 'list'] });
    },
    // A refused order means our copy of the bag and the total may be stale too.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: cartKey });
      void queryClient.invalidateQueries({ queryKey: [QUOTE_KEY] });
    },
  });
}

/**
 * Asks the API where to pay for an order. Safe to repeat: the API reuses a session it already has.
 * The browser never decides a payment succeeded, it only goes to the gateway and comes back to
 * read what the server recorded (invariant 4).
 */
export function useStartPayment() {
  return useMutation({
    mutationFn: (orderId: string) =>
      apiPost<{ redirectUrl: string }>(`/orders/${encodeURIComponent(orderId)}/payment-session`),
  });
}

/**
 * Cancels one of the customer's orders. Repeating it is harmless: the API answers with the order,
 * already cancelled. Whatever the result, the page shows the server's copy of the order after.
 */
export function useCancelOrder(orderId: string) {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (reason: string | undefined) =>
      apiPost<OrderDetail>(`/orders/${encodeURIComponent(orderId)}/cancel`, {
        body: reason ? { reason } : {},
      }),
    onSuccess: (order) => {
      queryClient.setQueryData([ORDERS_KEY, 'detail', order.id], order);
      void queryClient.invalidateQueries({ queryKey: [ORDERS_KEY, 'list'] });
    },
    // Refused because the order moved on (it started being prepared): show what it is now.
    onError: () => {
      void queryClient.invalidateQueries({ queryKey: [ORDERS_KEY, 'detail', orderId] });
    },
  });
}

/** Waiting on verified evidence that can arrive at any moment, so the page keeps looking. */
const PAYMENT_POLL_MS = 5_000;

export function useOrder(orderId: string) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'detail', orderId],
    queryFn: () => apiGet<OrderDetail>(`/orders/${encodeURIComponent(orderId)}`),
    // Also while a refund is on its way, so "refunded" appears without a reload.
    refetchInterval: (query) =>
      query.state.data?.status === 'PENDING_PAYMENT' ||
      query.state.data?.refunds.some((refund) => refund.status === 'PENDING')
        ? PAYMENT_POLL_MS
        : false,
  });
}

export const ORDERS_PAGE_SIZE = 10;

export function useOrders(page: number) {
  return useQuery({
    queryKey: [ORDERS_KEY, 'list', page],
    queryFn: () =>
      apiGetPage<OrderSummary>('/orders', { query: { page, pageSize: ORDERS_PAGE_SIZE } }),
    placeholderData: keepPreviousData,
  });
}

/** The account's saved addresses. The address book invalidates this after every change it makes. */
export const addressesKey = ['addresses'] as const;

export function useSavedAddresses() {
  return useQuery({
    queryKey: addressesKey,
    queryFn: () => apiGet<SavedAddress[]>('/me/addresses'),
  });
}
