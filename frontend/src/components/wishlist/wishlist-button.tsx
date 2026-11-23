'use client';

import { HeartIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { toast } from 'sonner';

import { ApiErrorCode, errorMessage, isApiError } from '@/lib/api-error';
import { useSession } from '@/lib/auth-client';
import type { ProductCard } from '@/lib/catalog/types';
import { signInPath } from '@/lib/safe-redirect';
import { cn } from '@/lib/utils';
import { useIsSaved, useToggleWishlist } from '@/lib/wishlist/use-wishlist';

/**
 * The heart on a product card: saves the product to the customer's wishlist, or removes it.
 *
 * Saving needs an account (ADR 0016). A visitor the session read already knows is signed out
 * goes to sign-in and comes back to this page; anyone else's click is sent, and a 401 (a
 * session that expired or was revoked) sends them the same way. The session read decides
 * only where to send the click — the API is what refuses.
 *
 * A toggle button: the label names the action once, and `aria-pressed` carries whether the
 * piece is saved, so a screen reader hears "Save … to wishlist, pressed".
 */
export function WishlistButton({
  product,
  className,
}: {
  product: ProductCard;
  className?: string;
}) {
  const router = useRouter();
  const session = useSession();
  const saved = useIsSaved(product.id, Boolean(session.data));
  const toggle = useToggleWishlist();

  const signInToSave = () => {
    toast('Sign in to save pieces to your wishlist.');
    // Read at click time: the card is also rendered in prerendered shells, where search
    // params are not available to read during render.
    router.push(signInPath(`${window.location.pathname}${window.location.search}`));
  };

  const onClick = () => {
    if (!session.isPending && !session.data) {
      signInToSave();
      return;
    }

    const save = !saved;
    toggle.mutateAsync({ product, save }).then(
      () => {
        if (save) {
          toast.success('Saved to your wishlist', {
            action: { label: 'View wishlist', onClick: () => router.push('/wishlist') },
          });
        }
      },
      (error: unknown) => {
        if (isApiError(error) && error.code === ApiErrorCode.UNAUTHENTICATED) {
          signInToSave();
          return;
        }
        toast.error(errorMessage(error));
      },
    );
  };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={saved}
      aria-label={`Save ${product.name} to wishlist`}
      className={cn(
        'tap-target grid size-9 place-items-center rounded-full bg-background/85 text-foreground shadow-sm ring-1 ring-foreground/10 backdrop-blur-sm transition-[transform,background-color] duration-200',
        'hover:scale-105 hover:bg-background active:scale-95 motion-reduce:transition-none motion-reduce:hover:scale-100',
        'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
        className,
      )}
    >
      <HeartIcon
        aria-hidden="true"
        strokeWidth={1.6}
        className={cn('size-4 transition-colors', saved && 'fill-current text-foreground')}
      />
    </button>
  );
}
