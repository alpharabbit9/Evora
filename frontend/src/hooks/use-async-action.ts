'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { errorMessage } from '@/lib/api-error';

/**
 * Runs a one-off async action from an event handler — sign in, add to cart, place an
 * order, adjust stock — and owns the three things each handler would otherwise repeat:
 * the try/catch, the pending flag, and the failure message.
 *
 * It also refuses to start while a run is in flight, so a double-clicked submit button
 * cannot send the mutation twice. That is a UX guard, not a correctness one: a mutation
 * that must not take effect twice still needs an idempotency key on the request
 * (`newIdempotencyKey` in `lib/api-client`).
 *
 * Expected failures are returned, not thrown: `run` resolves to `undefined` and `error`
 * holds the reason, so a form can show field errors instead of unmounting into a boundary.
 */
export interface UseAsyncActionOptions<TArgs extends unknown[], TResult> {
  onSuccess?: (result: TResult, ...args: TArgs) => void;
  onError?: (error: Error, ...args: TArgs) => void;
  /** Toasted on success when set. */
  successMessage?: string | ((result: TResult) => string);
  /** Set to false where the form shows the failure itself. */
  toastOnError?: boolean;
}

export interface AsyncAction<TArgs extends unknown[], TResult> {
  run: (...args: TArgs) => Promise<TResult | undefined>;
  isPending: boolean;
  error: Error | undefined;
  reset: () => void;
}

export function useAsyncAction<TArgs extends unknown[], TResult>(
  action: (...args: TArgs) => Promise<TResult>,
  options: UseAsyncActionOptions<TArgs, TResult> = {},
): AsyncAction<TArgs, TResult> {
  const [isPending, setIsPending] = useState(false);
  const [error, setError] = useState<Error | undefined>(undefined);

  // Kept in a ref as well: state updates are async, so two fast clicks would both see
  // `isPending === false`.
  const inFlight = useRef(false);

  // Read through a ref so `run` stays stable even when the caller passes inline callbacks
  // (a changing `run` identity would restart any effect that depends on it). The ref is
  // written after render, never during it.
  const latest = useRef({ action, options });

  useEffect(() => {
    latest.current = { action, options };
  });

  const run = useCallback(async (...args: TArgs): Promise<TResult | undefined> => {
    if (inFlight.current) {
      return undefined;
    }

    inFlight.current = true;
    setIsPending(true);
    setError(undefined);

    const { action: currentAction, options: currentOptions } = latest.current;

    try {
      const result = await currentAction(...args);

      if (currentOptions.successMessage !== undefined) {
        toast.success(
          typeof currentOptions.successMessage === 'function'
            ? currentOptions.successMessage(result)
            : currentOptions.successMessage,
        );
      }

      currentOptions.onSuccess?.(result, ...args);
      return result;
    } catch (caught) {
      // An aborted request is a cancellation, not a failure to report.
      if (caught instanceof DOMException && caught.name === 'AbortError') {
        return undefined;
      }

      const failure = caught instanceof Error ? caught : new Error(String(caught));
      setError(failure);

      if (currentOptions.toastOnError !== false) {
        toast.error(errorMessage(failure));
      }

      currentOptions.onError?.(failure, ...args);
      return undefined;
    } finally {
      inFlight.current = false;
      setIsPending(false);
    }
  }, []);

  const reset = useCallback(() => {
    setError(undefined);
  }, []);

  return { run, isPending, error, reset };
}
