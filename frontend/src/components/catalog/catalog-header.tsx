import { PageHeader } from '@/components/layout/page-header';
import { Skeleton } from '@/components/ui/skeleton';

const HEADER_FRAME =
  'mx-auto w-full max-w-[1680px] px-4 pt-10 pb-8 sm:px-6 sm:pt-14 lg:px-10 xl:px-14';

/**
 * Static opener for a listing page without a banner (search): the store's `PageHeader`, with
 * the demo-catalog notice under whatever the page adds. A Server Component, so it is part of the
 * prerendered shell while the listing streams in below.
 */
export function CatalogHeader({
  eyebrow,
  title,
  description,
  children,
}: {
  eyebrow: string;
  title: string;
  description?: string;
  children?: React.ReactNode;
}) {
  return (
    <PageHeader className={HEADER_FRAME} eyebrow={eyebrow} title={title} description={description}>
      {children}
      <DemoNotice />
    </PageHeader>
  );
}

/** The header's footprint — eyebrow, heading, copy, notice — for a route still loading. */
export function CatalogHeaderSkeleton() {
  return (
    <div className={HEADER_FRAME} aria-hidden="true">
      <Skeleton className="h-3 w-28" />
      <Skeleton className="mt-5 h-[clamp(2.2rem,1.6rem+2.2vw,3.5rem)] w-72 max-w-full" />
      <Skeleton className="mt-4 h-4 w-full max-w-xl" />
      <Skeleton className="mt-6 h-10 w-full max-w-2xl" />
    </div>
  );
}

/**
 * The catalog is a development dataset with synthetic prices and stock
 * (docs/fashion-catalog-integration-plan.md decision D1). It must say so wherever products
 * are shown for sale.
 */
export function DemoNotice({ className }: { className?: string }) {
  return (
    <p
      className={
        className ??
        'mt-6 max-w-2xl border-l border-border pl-3 text-xs leading-5 text-muted-foreground'
      }
    >
      Demo catalog: product photos and names come from the Kaggle “Fashion Product Images” dataset,
      and prices and stock are generated for development. Nothing here is for sale.
    </p>
  );
}
