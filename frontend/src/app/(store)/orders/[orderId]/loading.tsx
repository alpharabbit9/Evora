import { PageTransition } from '@/components/layout/page-transition';
import { OrderPageSkeleton } from '@/components/orders/order-skeleton';

export default function OrderLoading() {
  return (
    <PageTransition>
      <OrderPageSkeleton />
    </PageTransition>
  );
}
