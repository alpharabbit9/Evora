'use client';

import { catchError, type ErrorInfo } from 'next/error';

import { ErrorState } from './error-state';

/**
 * Component-level error boundary.
 *
 * Built on Next 16's `catchError` rather than a hand-written React boundary class, because
 * that version knows what `redirect()` and `notFound()` throw (they must pass through, not
 * be caught here) and its `retry()` re-renders inside a transition, so an uncaught render
 * error can be recovered from without a full reload.
 *
 * Use it for a widget whose failure should not take down the page; a whole route segment
 * is better served by its own `error.tsx` file.
 */
function ErrorBoundaryFallback(
  props: { title?: string; className?: string },
  { error, retry }: ErrorInfo,
) {
  return (
    <ErrorState
      error={error}
      {...(props.title === undefined ? {} : { title: props.title })}
      {...(props.className === undefined ? {} : { className: props.className })}
      onRetry={() => {
        retry();
      }}
    />
  );
}

export const ErrorBoundary = catchError(ErrorBoundaryFallback);
