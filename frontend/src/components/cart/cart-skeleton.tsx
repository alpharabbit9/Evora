import { PageHeaderSkeleton } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** The bag page's frame and two-column layout, shared with the real ones so nothing jumps. */
export const CART_FRAME =
  'mx-auto w-full max-w-[1680px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10 xl:px-14';
export const CART_COLUMNS = 'grid gap-12 lg:grid-cols-[minmax(0,1fr)_340px] lg:gap-16';

/** Line rows and the summary panel in their final positions, while the bag loads. */
export function CartSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className={CART_COLUMNS}>
      <ul aria-hidden="true" className="divide-y divide-border border-y border-border">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="flex gap-4 py-6 sm:gap-6">
            <Skeleton className="aspect-[3/4] w-24 shrink-0 rounded-none sm:w-28" />
            <div className="flex min-w-0 flex-1 flex-col gap-3">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-1/4" />
              <div className="mt-auto flex items-end justify-between gap-4">
                <Skeleton className="h-[38px] w-[106px] rounded-none" />
                <Skeleton className="h-4 w-20" />
              </div>
            </div>
          </li>
        ))}
      </ul>

      <div aria-hidden="true" className="self-start border border-border p-6">
        <Skeleton className="h-3 w-20" />
        <div className="mt-5 flex items-baseline justify-between gap-4">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-24" />
        </div>
        <div className="mt-5 flex flex-col gap-2 border-t border-border pt-5">
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-2/3" />
        </div>
      </div>

      <span className="sr-only">Loading your bag</span>
    </div>
  );
}

/** The whole page, heading included, for the route's `loading.tsx`. */
export function CartPageSkeleton() {
  return (
    <div className={CART_FRAME}>
      <PageHeaderSkeleton />
      <div className="mt-10">
        <CartSkeleton />
      </div>
    </div>
  );
}
