'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { Cart } from '@/lib/catalog/types';

/**
 * The cart, as the API reports it. There is one cache entry for the whole app — the header
 * badge, the product page and `/cart` all read it — and every mutation replaces it with the
 * cart the server returns, so nothing in the browser ever adds up prices or quantities.
 *
 * The request body names a variant and a quantity only. Price and stock are the server's
 * business (API_SPEC.md §5): it rejects a sold-out or unpublished variant with an
 * `ApiError` the caller can show as-is.
 *
 * Personalised data: never cached by the server or shared between visitors. The cart belongs
 * to an account (ADR 0014) and the API answers 401 without a session; `apiFetch` sends the
 * session cookie with `credentials`.
 */
export const cartKey = ['cart'] as const;

export function fetchCart(): Promise<Cart> {
  return apiGet<Cart>('/cart');
}

export function useCart({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: cartKey, queryFn: fetchCart, enabled });
}

/**
 * Item count for the header, read only for a signed-in user — a signed-out visitor has no
 * cart, so asking would only earn a 401 on every page. When the user changes (sign-in,
 * sign-out) the cached cart is dropped rather than refreshed in place: it belongs to the
 * previous user, and must not show even while the next read is in flight. Signing in is also
 * when the server folds a pre-ADR 0014 guest bag into the account.
 *
 * `undefined` while signed out, or while the first read is in flight or failed, so the badge
 * shows nothing rather than a misleading zero.
 */
export function useCartBadge(userId: string | undefined): number | undefined {
  const queryClient = useQueryClient();
  const signedIn = userId !== undefined;
  const cart = useCart({ enabled: signedIn });
  const previousUser = useRef(userId);

  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    void queryClient.resetQueries({ queryKey: cartKey });
  }, [userId, queryClient]);

  return signedIn ? cart.data?.itemCount : undefined;
}

export interface AddToCartInput {
  readonly variantId: string;
  readonly quantity: number;
}

export function useAddToCart() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AddToCartInput) => apiPost<Cart>('/cart/items', { body: input }),
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey, cart);
    },
  });
}

export function useUpdateCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ itemId, quantity }: { itemId: string; quantity: number }) =>
      apiPatch<Cart>(`/cart/items/${encodeURIComponent(itemId)}`, { body: { quantity } }),
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey, cart);
    },
    // A refused change (sold out meanwhile) means our copy may be stale too.
    onError: () => queryClient.invalidateQueries({ queryKey: cartKey }),
  });
}

export function useRemoveCartItem() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (itemId: string) => apiDelete<Cart>(`/cart/items/${encodeURIComponent(itemId)}`),
    onSuccess: (cart) => {
      queryClient.setQueryData(cartKey, cart);
    },
    onError: () => queryClient.invalidateQueries({ queryKey: cartKey }),
  });
}
