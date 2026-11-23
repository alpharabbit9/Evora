import { ListingPageSkeleton } from '@/components/catalog/listing-fallback';
import { PageTransition } from '@/components/layout/page-transition';

export default function ShopLoading() {
  return (
    <PageTransition>
      <ListingPageSkeleton banner />
    </PageTransition>
  );
}
