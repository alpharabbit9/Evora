'use client';

import { useSyncExternalStore } from 'react';

const subscribe = () => () => {};

/**
 * `false` in the server render and until React has hydrated this component, `true` after.
 *
 * A form whose submit is handled in JavaScript can be submitted natively before that: the
 * browser then sends a GET with every named field in the URL. For a password form that puts
 * the password in history and server logs, so those forms keep their submit button disabled
 * until this is `true` (a disabled default button also blocks submitting with Enter).
 */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => true,
    () => false,
  );
}
