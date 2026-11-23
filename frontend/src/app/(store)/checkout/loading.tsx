import { CartPageSkeleton } from '@/components/cart/cart-skeleton';
import { PageTransition } from '@/components/layout/page-transition';

export default function CheckoutLoading() {
  return (
    <PageTransition>
      <CartPageSkeleton />
    </PageTransition>
  );
}
