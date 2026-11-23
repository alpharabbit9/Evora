import { PageHeaderSkeleton } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

/** The account page's frame: the store's container, like the bag and the wishlist. */
export const ACCOUNT_FRAME =
  'mx-auto w-full max-w-[1680px] flex-1 px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10 xl:px-14';

/**
 * Under the header: from `lg`, the section index in a narrow column beside a reading-width
 * column of sections. Below `lg`, the sections alone.
 */
export const ACCOUNT_COLUMNS =
  'mt-10 lg:grid lg:grid-cols-[minmax(11rem,14rem)_minmax(0,42rem)] lg:gap-16 xl:gap-24';

/** The profile form and the first sections, at roughly their final size, while the session is read. */
export function AccountDetailsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-8">
      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <Skeleton className="h-5 w-20" />
        <Skeleton className="h-11 w-full" />
        <Skeleton className="h-10 w-64 max-w-full" />
        <Skeleton className="h-11 w-32" />
      </div>
      <div className="flex flex-col gap-4 border-t border-border pt-8">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-28 w-full" />
      </div>
      <span className="sr-only">Loading your account</span>
    </div>
  );
}

/** The whole page, heading included, for the route's `loading.tsx`. */
export function AccountPageSkeleton() {
  return (
    <div className={ACCOUNT_FRAME}>
      <PageHeaderSkeleton />
      <div className={ACCOUNT_COLUMNS}>
        <div aria-hidden="true" className="hidden flex-col gap-3 lg:flex">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-full" />
        </div>
        <AccountDetailsSkeleton />
      </div>
    </div>
  );
}
