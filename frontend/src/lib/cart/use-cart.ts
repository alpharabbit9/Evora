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
 * Personalised data: never cached by the server or shared between visitors. The guest cart
 * cookie is httpOnly, so it is invisible here; `apiFetch` sends it with `credentials`.
 */
export const cartKey = ['cart'] as const;

export function fetchCart(): Promise<Cart> {
  return apiGet<Cart>('/cart');
}

export function useCart() {
  return useQuery({ queryKey: cartKey, queryFn: fetchCart });
}

/**
 * Item count for the header. When the signed-in user changes (sign-in, sign-out), the cart
 * is re-read: signing in merges the guest bag into the account's on the server, and signing
 * out must not keep showing the account's count.
 *
 * `undefined` while the first read is in flight or failed, so the badge shows nothing rather
 * than a misleading zero.
 */
export function useCartBadge(userId: string | undefined): number | undefined {
  const queryClient = useQueryClient();
  const cart = useCart();
  const previousUser = useRef(userId);

  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    void queryClient.invalidateQueries({ queryKey: cartKey });
  }, [userId, queryClient]);

  return cart.data?.itemCount;
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
