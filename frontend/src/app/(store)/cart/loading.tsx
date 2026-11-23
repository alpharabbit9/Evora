import { CartPageSkeleton } from '@/components/cart/cart-skeleton';
import { PageTransition } from '@/components/layout/page-transition';

export default function CartLoading() {
  return (
    <PageTransition>
      <CartPageSkeleton />
    </PageTransition>
  );
}
