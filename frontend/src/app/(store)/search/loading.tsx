import { ListingPageSkeleton } from '@/components/catalog/listing-fallback';
import { PageTransition } from '@/components/layout/page-transition';

export default function SearchLoading() {
  return (
    <PageTransition>
      <ListingPageSkeleton />
    </PageTransition>
  );
}
