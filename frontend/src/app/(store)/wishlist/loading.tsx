import { PageTransition } from '@/components/layout/page-transition';
import { WishlistPageSkeleton } from '@/components/wishlist/wishlist-skeleton';

export default function WishlistLoading() {
  return (
    <PageTransition>
      <WishlistPageSkeleton />
    </PageTransition>
  );
}
