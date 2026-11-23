import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignedInOnly } from '@/components/auth/signed-in-only';
import { CART_FRAME, CartSkeleton } from '@/components/cart/cart-skeleton';
import { CartView } from '@/components/cart/cart-view';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false },
};

/**
 * The bag belongs to an account (ADR 0014): `SignedInOnly` sends anyone without a valid
 * session to sign-in, and the API refuses the cart to them anyway.
 *
 * The cart itself is personal, so it is read in the browser (with the session cookie) and
 * never rendered or cached on the server (architecture.md §10). The heading is static.
 */
export default function CartPage() {
  return (
    <PageTransition>
      <div className={CART_FRAME}>
        <PageHeader eyebrow="Bag" title="Your bag" />
        <div className="mt-10">
          <Suspense fallback={<CartSkeleton />}>
            <SignedInOnly path="/cart">{() => <CartView />}</SignedInOnly>
          </Suspense>
        </div>
      </div>
    </PageTransition>
  );
}
