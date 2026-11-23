'use client';

import { HeartIcon } from 'lucide-react';
import Link from 'next/link';

import { PRODUCT_GRID, ProductCard } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { BatchReveal } from '@/components/storefront/scroll-motion';
import type { Wishlist } from '@/lib/catalog/types';
import { ENTER } from '@/lib/motion/enter';
import { useListPresence } from '@/lib/motion/list-presence';
import { cn } from '@/lib/utils';
import { useWishlist } from '@/lib/wishlist/use-wishlist';

import { WishlistSkeleton } from './wishlist-skeleton';

/**
 * The customer's saved pieces, newest first, as the same cards the catalog shows — today's
 * price and stock, read from the catalog on every request. A piece taken down since it was
 * saved is not listed (ADR 0016). The heart on each card removes it, and the card leaves the
 * grid at once.
 *
 * Saving is product-level, so there is no "add to bag" here: size and colour are chosen on
 * the product page, which each card links to.
 *
 * The cards rise in row by row as they scroll into view, as on `/shop` (`BatchReveal`, GSAP,
 * once; reduced motion fades). A removed card fades out where it was, and the cards after it
 * glide into the gap (`useListPresence`); the last one hands over to the empty state's fade.
 */
export function WishlistView() {
  const wishlist = useWishlist();

  return (
    <QueryState
      query={wishlist}
      pending={<WishlistSkeleton />}
      errorTitle="We couldn't load your wishlist"
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyState
          className={cn(ENTER, 'duration-500')}
          icon={<HeartIcon className="size-6" strokeWidth={1.25} />}
          title="Your wishlist is empty"
          description="Tap the heart on any piece to keep it here for later."
          action={
            <Link
              href="/shop"
              className="mt-2 border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Browse the collection
            </Link>
          }
        />
      }
    >
      {(data) => <WishlistGrid wishlist={data} />}
    </QueryState>
  );
}

/**
 * The count and the grid. GSAP owns each `li`'s entrance (`BatchReveal`); the wrapper inside it
 * is the exit's and the move's own element (Web Animations API, `useListPresence`), so no
 * property has two owners.
 */
function WishlistGrid({ wishlist }: { wishlist: Wishlist }) {
  const cards = useListPresence(wishlist.items, (item) => item.product.id);

  return (
    <div>
      <p aria-live="polite" className="text-sm text-muted-foreground tabular-nums">
        {wishlist.count} saved {wishlist.count === 1 ? 'piece' : 'pieces'}
      </p>
      <BatchReveal as="ul" className={`mt-8 ${PRODUCT_GRID}`}>
        {cards.entries.map((entry) => (
          <li key={entry.key}>
            <div {...cards.bind(entry)}>
              <ProductCard product={entry.item.product} />
            </div>
          </li>
        ))}
      </BatchReveal>
    </div>
  );
}
