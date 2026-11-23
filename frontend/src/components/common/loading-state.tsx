import { Loader2Icon } from 'lucide-react';

import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The shared "working on it" states (implementation-plan.md M1).
 *
 * Both announce themselves to assistive technology, which is the part that gets forgotten
 * when every page spins up its own spinner.
 */
export function LoadingState({
  label = 'Loading',
  className,
  ...props
}: React.ComponentProps<'div'> & { label?: string }) {
  return (
    <div
      data-slot="loading-state"
      role="status"
      aria-live="polite"
      className={cn('flex flex-col items-center justify-center gap-3 px-6 py-16', className)}
      {...props}
    >
      <Loader2Icon className="size-5 animate-spin text-muted-foreground" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </div>
  );
}

/**
 * A neutral page — eyebrow, heading, intro, a large block — for a store route that has no
 * skeleton of its own yet (`app/(store)/loading.tsx`). Routes with a known layout use theirs.
 */
export function PageSkeleton({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="page-skeleton"
      role="status"
      aria-live="polite"
      className={cn(
        'mx-auto flex w-full max-w-[1680px] flex-col px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10 xl:px-14',
        className,
      )}
      {...props}
    >
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-5 h-[clamp(2.2rem,1.6rem+2.2vw,3.5rem)] w-72 max-w-full" />
      <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      <Skeleton className="mt-10 aspect-[16/7] w-full rounded-2xl" />
      <span className="sr-only">Loading</span>
    </div>
  );
}

/**
 * Placeholder rows for a list that is loading for the first time. Prefer this over a
 * spinner where the final layout is known, so the page does not jump when data lands.
 */
export function LoadingRows({
  rows = 5,
  className,
  ...props
}: React.ComponentProps<'div'> & { rows?: number }) {
  return (
    <div
      data-slot="loading-rows"
      role="status"
      aria-live="polite"
      className={cn('flex flex-col gap-3', className)}
      {...props}
    >
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-14 w-full" />
      ))}
      <span className="sr-only">Loading</span>
    </div>
  );
}
