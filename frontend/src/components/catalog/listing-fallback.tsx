import { ProductGridSkeleton } from './product-card';

/**
 * What a listing page shows before `CatalogBrowser` has read the URL: the toolbar rule and a
 * skeleton grid in the same place as the real ones, so nothing jumps when it arrives.
 */
export function ListingFallback() {
  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 pb-24 sm:px-6 lg:px-10 xl:px-14">
      <div className="h-[57px] border-y border-border" />
      <div className="mt-8 lg:ml-[268px] xl:ml-[314px]">
        <ProductGridSkeleton count={8} />
      </div>
    </div>
  );
}
