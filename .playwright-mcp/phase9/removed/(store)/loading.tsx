import { PageSkeleton } from '@/components/common/loading-state';
import { PageTransition } from '@/components/layout/page-transition';

/**
 * Fallback for any store route without a `loading.tsx` of its own, so a navigation whose
 * prefetch has not finished still answers at once instead of waiting on the server.
 */
export default function StoreLoading() {
  return (
    <PageTransition>
      <PageSkeleton />
    </PageTransition>
  );
}
