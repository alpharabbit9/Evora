import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignedInOnly } from '@/components/auth/signed-in-only';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';
import { ORDER_FRAME, OrderSkeleton } from '@/components/orders/order-skeleton';
import { OrderView } from '@/components/orders/order-view';

export const metadata: Metadata = {
  title: 'Your order',
  robots: { index: false },
};

/**
 * An order and its confirmation are the same page. `SignedInOnly` turns away anyone without a
 * session, and the API answers 404 for an order that belongs to someone else (invariant 7).
 */
export default function OrderPage({ params }: PageProps<'/orders/[orderId]'>) {
  return (
    <PageTransition>
      <div className={ORDER_FRAME}>
        <PageHeader eyebrow="Order" title="Your order" />
        <div className="mt-10">
          <Suspense fallback={<OrderSkeleton />}>
            {params.then(({ orderId }) => (
              <SignedInOnly path={`/orders/${encodeURIComponent(orderId)}`}>
                {() => <OrderView orderId={orderId} />}
              </SignedInOnly>
            ))}
          </Suspense>
        </div>
      </div>
    </PageTransition>
  );
}
