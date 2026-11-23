'use client';

import { MinusIcon, PlusIcon, ShoppingBagIcon, XIcon } from 'lucide-react';
import Link from 'next/link';

import { ProductImage } from '@/components/catalog/product-image';
import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { useAsyncAction } from '@/hooks/use-async-action';
import { useCart, useRemoveCartItem, useUpdateCartItem } from '@/lib/cart/use-cart';
import type { Cart, CartLine, CartLineStatus } from '@/lib/catalog/types';
import { formatMoney } from '@/lib/money';
import { ENTER } from '@/lib/motion/enter';
import { useListPresence } from '@/lib/motion/list-presence';
import { cn } from '@/lib/utils';

import { CART_COLUMNS, CartSkeleton } from './cart-skeleton';

/** Gap between one bag line's entrance and the next. */
const LINE_STAGGER_MS = 60;

/** Mirrors the API's per-line cap; the server enforces it. */
const MAX_QUANTITY = 10;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const STATUS_COPY: Record<Exclude<CartLineStatus, 'available'>, string> = {
  insufficient_stock: 'Not enough left for this quantity. Lower it to continue.',
  out_of_stock: 'Sold out. Remove it to continue.',
  unavailable: 'No longer available. Remove it to continue.',
};

/**
 * The bag, exactly as the server priced it. Quantities and removals go to the API and the
 * whole cart comes back; the subtotal shown is the server's, counting only lines that can be
 * bought as they stand.
 */
export function CartView() {
  const cart = useCart();

  return (
    <QueryState
      query={cart}
      pending={<CartSkeleton />}
      errorTitle="We couldn't load your bag"
      isEmpty={(data) => data.items.length === 0}
      empty={
        <EmptyState
          // Fades in, so removing the last line hands over to it instead of snapping.
          className={cn(ENTER, 'duration-500')}
          icon={<ShoppingBagIcon className="size-6" strokeWidth={1.25} />}
          title="Your bag is empty"
          description="Pieces you add from the collection will wait here."
          action={
            <Link
              href="/shop"
              className="mt-2 border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground"
            >
              Browse the collection
            </Link>
          }
        />
      }
    >
      {(data) => <CartContents cart={data} />}
    </QueryState>
  );
}

/**
 * Entrance (CSS, `lib/motion/enter.ts`): when the bag first loads, its lines rise in one after
 * another and the summary fades in beside them. Keyed lines are not remounted when the cart is
 * re-read after a change, so the entrance plays once, not on every quantity step. Reduced
 * motion: none.
 *
 * Exit (`useListPresence`): a removed line folds away (height and opacity) once the server has
 * confirmed it, and the lines below close the gap with it. The wrapper inside each `li` is the
 * exit's own element, so it never shares a property with the CSS entrance on the `li`.
 */
function CartContents({ cart }: { cart: Cart }) {
  const lines = useListPresence(cart.items, (line) => line.id, { exit: 'collapse' });

  return (
    <div className={CART_COLUMNS}>
      <ul className="divide-y divide-border border-y border-border">
        {lines.entries.map((entry, index) => (
          <li
            key={entry.key}
            className={cn(ENTER, 'duration-700 slide-in-from-bottom-3')}
            style={{ animationDelay: `${String(Math.min(index, 8) * LINE_STAGGER_MS)}ms` }}
          >
            <div {...lines.bind(entry)}>
              <CartLineRow line={entry.item} currency={cart.currency} />
            </div>
          </li>
        ))}
      </ul>

      <aside
        aria-labelledby="bag-summary"
        className={cn(
          ENTER,
          'self-start border border-border p-6 delay-150 duration-700 lg:sticky lg:top-28',
        )}
      >
        <h2
          id="bag-summary"
          className="text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase"
        >
          Summary
        </h2>
        <dl className="mt-5 flex items-baseline justify-between gap-4 text-sm">
          <dt>Subtotal</dt>
          <dd className="text-base tabular-nums">
            {formatMoney(cart.subtotalMinor, cart.currency)}
          </dd>
        </dl>
        {cart.hasIssues ? (
          <p className="mt-3 text-xs leading-5 text-destructive">
            Some items can’t be bought as they are and aren’t included in the subtotal. Sort them
            out to check out.
          </p>
        ) : null}
        {cart.hasIssues ? null : (
          <Link
            href="/checkout"
            className={cn(
              'mt-5 flex h-12 items-center justify-center rounded-md bg-foreground px-6 text-sm font-semibold text-background transition-opacity hover:opacity-85',
              focusRing,
            )}
          >
            Checkout
          </Link>
        )}
        <p className="mt-5 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
          Prices and stock are checked again on the server whenever your bag changes. Delivery is
          calculated at checkout for your address.
        </p>
      </aside>
    </div>
  );
}

function CartLineRow({ line, currency }: { line: CartLine; currency: string }) {
  const update = useUpdateCartItem();
  const remove = useRemoveCartItem();

  const setQuantity = useAsyncAction((quantity: number) =>
    update.mutateAsync({ itemId: line.id, quantity }),
  );
  const removeLine = useAsyncAction(() => remove.mutateAsync(line.id), {
    successMessage: `Removed ${line.product.name}`,
  });

  const busy = setQuantity.isPending || removeLine.isPending;
  const problem = line.status === 'available' ? null : STATUS_COPY[line.status];
  const details = [line.variant.color, line.variant.size ? `Size ${line.variant.size}` : null]
    .filter(Boolean)
    .join(' · ');

  return (
    <div className={cn('flex gap-4 py-6 sm:gap-6', busy && 'opacity-60')} aria-busy={busy}>
      <Link
        href={`/products/${line.product.slug}`}
        className={cn(
          'relative aspect-[3/4] w-24 shrink-0 overflow-hidden bg-muted sm:w-28',
          focusRing,
        )}
        tabIndex={-1}
        aria-hidden="true"
      >
        <ProductImage image={line.product.image} sizes="112px" />
      </Link>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            {line.product.brand ? (
              <p className="text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
                {line.product.brand}
              </p>
            ) : null}
            <Link
              href={`/products/${line.product.slug}`}
              className={cn('mt-1 block text-sm leading-snug hover:underline', focusRing)}
            >
              {line.product.name}
            </Link>
            {details ? <p className="mt-1 text-xs text-muted-foreground">{details}</p> : null}
          </div>
          <button
            type="button"
            aria-label={`Remove ${line.product.name}`}
            // While the removal is in flight the button stays focusable (`aria-disabled`, not
            // `disabled`), so focus is still here to hand on to the next line when this one
            // folds away. `useAsyncAction` refuses a second run meanwhile.
            disabled={setQuantity.isPending}
            aria-disabled={removeLine.isPending || undefined}
            onClick={() => {
              void removeLine.run();
            }}
            className={cn(
              'grid size-8 shrink-0 place-items-center text-muted-foreground hover:text-foreground',
              focusRing,
            )}
          >
            <XIcon className="size-4" aria-hidden="true" />
          </button>
        </div>

        {problem ? (
          <p role="status" className="text-xs text-destructive">
            {problem}
          </p>
        ) : null}

        {/* The bag always charges today's price; this only says it differs from the one the
            customer saw. It clears once they change the line. */}
        {line.previousUnitPriceMinor !== null && line.status !== 'unavailable' ? (
          <p className="text-xs text-muted-foreground">
            {line.unitPriceMinor > line.previousUnitPriceMinor ? 'Price went up' : 'Price dropped'}{' '}
            since you added this, from <s>{formatMoney(line.previousUnitPriceMinor, currency)}</s>{' '}
            to <span className="text-foreground">{formatMoney(line.unitPriceMinor, currency)}</span>{' '}
            each.
          </p>
        ) : null}

        <div className="mt-auto flex items-end justify-between gap-4">
          {line.status === 'unavailable' ? (
            <span className="text-xs text-muted-foreground tabular-nums">Qty {line.quantity}</span>
          ) : (
            <div
              className="flex items-center border border-border"
              role="group"
              aria-label={`Quantity of ${line.product.name}`}
            >
              <button
                type="button"
                aria-label="Decrease quantity"
                disabled={busy || line.quantity <= 1}
                onClick={() => {
                  void setQuantity.run(line.quantity - 1);
                }}
                className={cn('grid size-9 place-items-center disabled:opacity-30', focusRing)}
              >
                <MinusIcon className="size-3.5" aria-hidden="true" />
              </button>
              <output className="w-8 text-center text-sm tabular-nums">{line.quantity}</output>
              <button
                type="button"
                aria-label="Increase quantity"
                disabled={busy || line.quantity >= MAX_QUANTITY || line.status !== 'available'}
                onClick={() => {
                  void setQuantity.run(line.quantity + 1);
                }}
                className={cn('grid size-9 place-items-center disabled:opacity-30', focusRing)}
              >
                <PlusIcon className="size-3.5" aria-hidden="true" />
              </button>
            </div>
          )}
          <p className="text-right text-sm tabular-nums">
            <span className="block">{formatMoney(line.lineTotalMinor, currency)}</span>
            {line.quantity > 1 ? (
              <span className="block text-xs text-muted-foreground">
                {formatMoney(line.unitPriceMinor, currency)} each
              </span>
            ) : null}
          </p>
        </div>
      </div>
    </div>
  );
}
