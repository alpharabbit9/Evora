import { CART_COLUMNS, CART_FRAME } from '@/components/cart/cart-skeleton';
import { PageHeaderSkeleton } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** Same frame as the bag and checkout, so moving between the three does not shift the page. */
export const ORDER_FRAME = CART_FRAME;

/** Lines and the totals panel in their final positions, while the order loads. */
export function OrderSkeleton() {
  return (
    <div role="status" aria-live="polite" className={CART_COLUMNS}>
      <div aria-hidden="true" className="flex flex-col gap-4">
        <Skeleton className="h-4 w-40" />
        {Array.from({ length: 2 }, (_, index) => (
          <div key={index} className="flex gap-4 border-t border-border py-5">
            <Skeleton className="aspect-[3/4] w-20 shrink-0 rounded-none" />
            <div className="flex flex-1 flex-col gap-2">
              <Skeleton className="h-4 w-3/5" />
              <Skeleton className="h-3 w-1/4" />
            </div>
          </div>
        ))}
      </div>
      <div aria-hidden="true" className="self-start border border-border p-6">
        <Skeleton className="h-3 w-20" />
        <div className="mt-5 flex flex-col gap-3">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-5 w-full" />
        </div>
      </div>
      <span className="sr-only">Loading your order</span>
    </div>
  );
}

/** The whole page, heading included, for the route's `loading.tsx`. */
export function OrderPageSkeleton() {
  return (
    <div className={ORDER_FRAME}>
      <PageHeaderSkeleton />
      <div className="mt-10">
        <OrderSkeleton />
      </div>
    </div>
  );
}
