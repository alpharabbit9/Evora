import type { Metadata } from 'next';

import { CartView } from '@/components/cart/cart-view';

export const metadata: Metadata = {
  title: 'Your bag',
  robots: { index: false },
};

/**
 * The cart is personal, so it is read in the browser (with the session or guest cookie) and
 * never rendered or cached on the server (architecture.md §10). The heading is static.
 */
export default function CartPage() {
  return (
    <div className="mx-auto w-full max-w-[1680px] px-4 pt-10 pb-24 sm:px-6 sm:pt-14 lg:px-10 xl:px-14">
      <h1 className="font-heading text-[clamp(2.2rem,1.6rem+2.2vw,3.5rem)] leading-[1.04] font-normal tracking-[-0.015em]">
        Your bag
      </h1>
      <div className="mt-10">
        <CartView />
      </div>
    </div>
  );
}
