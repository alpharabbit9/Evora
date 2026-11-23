import { ProductGridSkeleton } from '@/components/catalog/product-card';
import { PageHeaderSkeleton } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** The page's frame, shared with its skeleton so nothing jumps. */
export const WISHLIST_FRAME =
  'mx-auto w-full max-w-[1680px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10 xl:px-14';

/** The count line and a short grid, while the list is read. */
export function WishlistSkeleton() {
  return (
    <div>
      <Skeleton className="h-4 w-28" aria-hidden="true" />
      <div className="mt-8">
        <ProductGridSkeleton count={4} />
      </div>
    </div>
  );
}

/** The whole page, heading included, for the route's `loading.tsx`. */
export function WishlistPageSkeleton() {
  return (
    <div className={WISHLIST_FRAME}>
      <PageHeaderSkeleton />
      <div className="mt-10">
        <WishlistSkeleton />
      </div>
    </div>
  );
}
