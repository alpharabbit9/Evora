'use client';

import { Suspense } from 'react';

import { ErrorBoundary } from './error-boundary';
import { LoadingState } from './loading-state';

/**
 * Loading and failure for an async subtree in one wrapper, so a streamed Server Component
 * or a `use()`-suspending client component gets both without each page pairing a
 * `<Suspense>` with its own boundary and sometimes forgetting one.
 *
 * The empty and success states belong to the data itself — see `QueryState` for a list
 * that has all four.
 */
export function AsyncBoundary({
  children,
  pending,
  title,
}: {
  children: React.ReactNode;
  /** Replaces the default spinner; pass skeletons that match the final layout. */
  pending?: React.ReactNode;
  /** Heading for the failure state. */
  title?: string;
}) {
  return (
    <ErrorBoundary {...(title === undefined ? {} : { title })}>
      <Suspense fallback={pending ?? <LoadingState />}>{children}</Suspense>
    </ErrorBoundary>
  );
}
