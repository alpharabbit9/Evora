import { Skeleton } from '@/components/ui/skeleton';

import { PRODUCT_COLUMNS, PRODUCT_CONTAINER } from './product-layout';

/** Breadcrumb, gallery and purchase panel in their final positions, while a product loads. */
export function ProductSkeleton() {
  return (
    <div role="status" aria-live="polite" className={`${PRODUCT_CONTAINER} pt-6 pb-24`}>
      <Skeleton className="h-3 w-48" />
      <div className={`mt-6 ${PRODUCT_COLUMNS}`}>
        <Skeleton className="aspect-[4/5] w-full rounded-2xl" />
        <div className="flex flex-col gap-4">
          <Skeleton className="h-6 w-24 rounded-full" />
          <Skeleton className="h-10 w-4/5" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="mt-4 h-8 w-32" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-11 w-3/4" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading product</span>
    </div>
  );
}
