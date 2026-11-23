'use client';

import { ShoppingBagIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { CartSkeleton } from '@/components/cart/cart-skeleton';
import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { useCart } from '@/lib/cart/use-cart';

import { CheckoutForm } from './checkout-form';

const LINK_CLASS =
  'mt-2 border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground';

/**
 * What can be checked out comes from the server's bag. A bag with a line that can't be bought
 * goes back to `/cart` to be sorted out, because that is where a line can be changed.
 *
 * Once an order is placed the bag empties while the confirmation page loads, so that moment is
 * its own state instead of a flash of "your bag is empty".
 */
export function CheckoutView() {
  const cart = useCart();
  const [placed, setPlaced] = useState(false);

  if (placed) {
    return (
      <p role="status" className="py-16 text-center text-sm text-muted-foreground">
        Order placed. One moment…
      </p>
    );
  }

  return (
    <QueryState
      query={cart}
      pending={<CartSkeleton />}
      errorTitle="We couldn't load your bag"
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyState
          icon={<ShoppingBagIcon className="size-6" strokeWidth={1.25} />}
          title="Your bag is empty"
          description="Add something to your bag to check out."
          action={
            <Link href="/shop" className={LINK_CLASS}>
              Browse the collection
            </Link>
          }
        />
      }
    >
      {(data) =>
        data.hasIssues ? (
          <EmptyState
            icon={<ShoppingBagIcon className="size-6" strokeWidth={1.25} />}
            title="Some items need your attention"
            description="An item in your bag is sold out, no longer available, or short of the quantity you chose."
            action={
              <Link href="/cart" className={LINK_CLASS}>
                Review your bag
              </Link>
            }
          />
        ) : (
          <CheckoutForm
            cart={data}
            onPlaced={() => {
              setPlaced(true);
            }}
          />
        )
      }
    </QueryState>
  );
}
