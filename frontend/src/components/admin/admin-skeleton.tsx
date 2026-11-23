import { Skeleton } from '@/components/ui/skeleton';

/** The content area of an admin page, shared by `loading.tsx` and the in-page gate's fallback. */
export function AdminPageSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-6">
      <Skeleton aria-hidden="true" className="h-7 w-48" />
      <Skeleton aria-hidden="true" className="h-8 w-full max-w-xl" />
      <AdminRowsSkeleton />
      <span className="sr-only">Loading</span>
    </div>
  );
}

export function AdminRowsSkeleton({ rows = 6 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-11 w-full" />
      ))}
    </div>
  );
}

/** What a visitor sees before the role check answers: nothing of the dashboard's navigation. */
export function AdminGateSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-1 flex-col gap-6 p-6 lg:p-10">
      <Skeleton aria-hidden="true" className="h-7 w-48" />
      <AdminRowsSkeleton />
      <span className="sr-only">Checking your access</span>
    </div>
  );
}
