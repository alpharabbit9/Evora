'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiDelete, apiGet, apiPatch, apiPost } from '@/lib/api-client';
import type { SavedAddress } from '@/lib/checkout/types';
import { addressesKey } from '@/lib/checkout/use-checkout';

/**
 * The customer's own account: profile, address book and signed-in sessions (API_SPEC.md §3).
 * Every endpoint here derives its subject from the session, so none of these take a user id.
 */

export interface Profile {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
}

/** `PATCH /me` accepts `name` and `image` only; anything else is a 400, never a silent drop. */
export function useUpdateProfile() {
  return useMutation({
    mutationFn: (input: { name: string }) => apiPatch<Profile>('/me', { body: input }),
  });
}

/** What the address forms send. The country is fixed by the form, not chosen. */
export interface AddressInput {
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

/**
 * Create, edit and delete share one invalidation: the list checkout reads (`addressesKey`). The
 * server reorders the list (default first) and clears the old default itself, so the browser
 * refetches rather than guessing the new order.
 */
export function useAddressMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: addressesKey });

  const create = useMutation({
    mutationFn: (input: AddressInput) => apiPost<SavedAddress>('/me/addresses', { body: input }),
    onSettled: refresh,
  });

  const update = useMutation({
    mutationFn: ({ id, input }: { id: string; input: Partial<AddressInput> }) =>
      apiPatch<SavedAddress>(`/me/addresses/${encodeURIComponent(id)}`, { body: input }),
    onSettled: refresh,
  });

  const remove = useMutation({
    mutationFn: (id: string) => apiDelete<undefined>(`/me/addresses/${encodeURIComponent(id)}`),
    onSettled: refresh,
  });

  return { create, update, remove };
}

/** One signed-in session, as `GET /me/sessions` projects it: never with its token. */
export interface AccountSession {
  readonly id: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly expiresAt: string;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  /** The session this page is using. */
  readonly current: boolean;
}

export const sessionsKey = ['account', 'sessions'] as const;

export function useAccountSessions() {
  return useQuery({
    queryKey: sessionsKey,
    queryFn: () => apiGet<AccountSession[]>('/me/sessions'),
  });
}

export function useRevokeSession() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (sessionId: string) =>
      apiDelete<undefined>(`/me/sessions/${encodeURIComponent(sessionId)}`),
    // Also on failure: a 404 means it had already ended, and the list should say so.
    onSettled: () => queryClient.invalidateQueries({ queryKey: sessionsKey }),
  });
}
