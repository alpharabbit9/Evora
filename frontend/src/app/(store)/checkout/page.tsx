import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignedInOnly } from '@/components/auth/signed-in-only';
import { CART_FRAME, CartSkeleton } from '@/components/cart/cart-skeleton';
import { CheckoutView } from '@/components/checkout/checkout-view';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';

export const metadata: Metadata = {
  title: 'Checkout',
  robots: { index: false },
};

/**
 * Signed-in only, like the bag it comes from (ADR 0014, ADR 0018). The form and its prices are
 * read in the browser with the session cookie and never rendered or cached on the server.
 */
export default function CheckoutPage() {
  return (
    <PageTransition>
      <div className={CART_FRAME}>
        <PageHeader eyebrow="Delivery & payment" title="Checkout" />
        <div className="mt-10">
          <Suspense fallback={<CartSkeleton />}>
            <SignedInOnly path="/checkout">{() => <CheckoutView />}</SignedInOnly>
          </Suspense>
        </div>
      </div>
    </PageTransition>
  );
}
