'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef } from 'react';

import { apiDelete, apiGet, apiPut } from '@/lib/api-client';
import type { ProductCard, Wishlist } from '@/lib/catalog/types';

/**
 * The signed-in customer's wishlist, as the API reports it (ADR 0016). One cache entry for the
 * whole app: the header count, every heart on every product card and `/wishlist` all read it,
 * and every save or removal answers with the whole list, so the browser never keeps a copy of
 * its own making for longer than one request.
 *
 * Personalised data: never cached by the server or shared between visitors, and read only
 * while signed in — the API answers 401 otherwise.
 */
export const wishlistKey = ['wishlist'] as const;

function itemPath(productId: string): string {
  return `/me/wishlist/items/${encodeURIComponent(productId)}`;
}

export function fetchWishlist(): Promise<Wishlist> {
  return apiGet<Wishlist>('/me/wishlist');
}

export function useWishlist({ enabled = true }: { enabled?: boolean } = {}) {
  return useQuery({ queryKey: wishlistKey, queryFn: fetchWishlist, enabled });
}

/** Whether one product is saved. `false` while signed out or before the first read lands. */
export function useIsSaved(productId: string, signedIn: boolean): boolean {
  const saved = useQuery({
    queryKey: wishlistKey,
    queryFn: fetchWishlist,
    enabled: signedIn,
    select: (wishlist) => wishlist.items.some((item) => item.product.id === productId),
  });

  return signedIn && saved.data === true;
}

/**
 * Saved-piece count for the header, read only for a signed-in user. When the user changes the
 * cached list is dropped, not refreshed in place: it belongs to the previous user. `undefined`
 * while signed out or unknown, so the header shows nothing rather than a misleading zero.
 */
export function useWishlistBadge(userId: string | undefined): number | undefined {
  const queryClient = useQueryClient();
  const signedIn = userId !== undefined;
  const count = useQuery({
    queryKey: wishlistKey,
    queryFn: fetchWishlist,
    enabled: signedIn,
    select: (wishlist) => wishlist.count,
  });
  const previousUser = useRef(userId);

  useEffect(() => {
    if (previousUser.current === userId) return;
    previousUser.current = userId;
    void queryClient.resetQueries({ queryKey: wishlistKey });
  }, [userId, queryClient]);

  return signedIn ? count.data : undefined;
}

export interface ToggleWishlistInput {
  /** The card being saved: shown in the list straight away, before the server answers. */
  readonly product: ProductCard;
  readonly save: boolean;
}

/**
 * Save or remove one product, optimistically: the heart and the list change on click.
 *
 * Toggles share one mutation scope, so they reach the server one at a time and in click
 * order, and only the last of a burst writes the server's list back into the cache. An
 * earlier answer would describe a list that later clicks have already changed, and showing
 * it would flip their hearts back for a moment. A failure re-reads the list instead of
 * restoring a snapshot, for the same reason. Both endpoints are idempotent, so a repeated
 * click is harmless on the server.
 */
export function useToggleWishlist() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationKey: wishlistKey,
    scope: { id: 'wishlist' },
    mutationFn: ({ product, save }: ToggleWishlistInput) =>
      save ? apiPut<Wishlist>(itemPath(product.id)) : apiDelete<Wishlist>(itemPath(product.id)),
    onMutate: async ({ product, save }) => {
      await queryClient.cancelQueries({ queryKey: wishlistKey });
      queryClient.setQueryData<Wishlist>(wishlistKey, (current) => {
        if (!current) return current;
        const others = current.items.filter((item) => item.product.id !== product.id);
        const items = save ? [{ savedAt: new Date().toISOString(), product }, ...others] : others;
        return { items, count: items.length };
      });
    },
    onSettled: (wishlist) => {
      // This one is still counted; anything above 1 is a later toggle that will settle the list.
      if (queryClient.isMutating({ mutationKey: wishlistKey }) > 1) return;

      if (wishlist) {
        queryClient.setQueryData(wishlistKey, wishlist);
      } else {
        void queryClient.invalidateQueries({ queryKey: wishlistKey });
      }
    },
  });
}
