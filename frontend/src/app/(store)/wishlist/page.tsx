import type { Metadata } from 'next';
import { Suspense } from 'react';

import { SignedInOnly } from '@/components/auth/signed-in-only';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';
import { WISHLIST_FRAME, WishlistSkeleton } from '@/components/wishlist/wishlist-skeleton';
import { WishlistView } from '@/components/wishlist/wishlist-view';

export const metadata: Metadata = {
  title: 'Wishlist',
  robots: { index: false },
};

/**
 * A customer's own saved pieces (ADR 0016). `SignedInOnly` sends anyone without a valid
 * session to sign-in, and the API refuses the list to them anyway (ADR 0014).
 *
 * The list is personal, so it is read in the browser with the session cookie and never
 * rendered or cached on the server (architecture.md §10). The heading is static.
 */
export default function WishlistPage() {
  return (
    <PageTransition>
      <div className={WISHLIST_FRAME}>
        <PageHeader eyebrow="Saved" title="Wishlist" />
        <div className="mt-10">
          <Suspense fallback={<WishlistSkeleton />}>
            <SignedInOnly path="/wishlist">{() => <WishlistView />}</SignedInOnly>
          </Suspense>
        </div>
      </div>
    </PageTransition>
  );
}
