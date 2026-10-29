'use client';

import type { UseQueryResult } from '@tanstack/react-query';

import { EmptyState } from './empty-state';
import { ErrorState } from './error-state';
import { LoadingState } from './loading-state';

/**
 * All four states of a read, in one place: loading, failed, empty, and loaded.
 *
 * Every list and detail view needs the same four (implementation-plan.md "definition of
 * done"), and hand-rolling them per page is how a screen ends up with a spinner that never
 * resolves or an empty table where a failure happened. The success branch is a function so
 * `data` reaches it already narrowed — no `data!` at the call site.
 */
export function QueryState<TData>({
  query,
  children,
  pending,
  empty,
  isEmpty,
  errorTitle,
}: {
  query: UseQueryResult<TData>;
  children: (data: TData) => React.ReactNode;
  /** Replaces the default spinner (skeletons that match the final layout). */
  pending?: React.ReactNode;
  empty?: React.ReactNode;
  /** Defaults to "an array with no items"; pass one for other shapes. */
  isEmpty?: (data: TData) => boolean;
  errorTitle?: string;
}) {
  if (query.isPending) {
    return pending ?? <LoadingState />;
  }

  if (query.isError) {
    return (
      <ErrorState
        error={query.error}
        {...(errorTitle === undefined ? {} : { title: errorTitle })}
        onRetry={() => {
          void query.refetch();
        }}
      />
    );
  }

  const { data } = query;

  const looksEmpty = isEmpty ? isEmpty(data) : Array.isArray(data) && data.length === 0;

  if (looksEmpty) {
    return empty ?? <EmptyState title="Nothing to show yet" />;
  }

  return children(data);
}
