import { ListingPageSkeleton } from '@/components/catalog/listing-fallback';
import { PageTransition } from '@/components/layout/page-transition';

/** Shared by Men, Women and New arrivals, which are all the same listing. */
export default function CollectionLoading() {
  return (
    <PageTransition>
      <ListingPageSkeleton banner />
    </PageTransition>
  );
}
