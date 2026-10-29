'use client';

import { ErrorState } from '@/components/common/error-state';

/**
 * The product could not be read for a reason other than "it does not exist" — the API is
 * down, or answered 5xx. `retry` re-renders the segment, which re-requests the product.
 */
export default function ProductError({ error, retry }: { error: unknown; retry: () => void }) {
  return (
    <div className="flex flex-1 items-center justify-center px-4 py-24">
      <ErrorState error={error} title="We couldn't load this product" onRetry={retry} />
    </div>
  );
}
