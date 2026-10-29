'use client';

import { MinusIcon, PlusIcon, RulerIcon, ShoppingBagIcon } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useId, useState } from 'react';
import { toast } from 'sonner';

import { swatchFill } from '@/components/catalog/color-swatch';
import { useAsyncAction } from '@/hooks/use-async-action';
import { ApiErrorCode, isApiError } from '@/lib/api-error';
import { useAddToCart } from '@/lib/cart/use-cart';
import type { Availability, ProductDetail, ProductVariant } from '@/lib/catalog/types';
import { formatMoney, formatPriceRange } from '@/lib/money';
import { cn } from '@/lib/utils';

import { SIZE_AND_FIT_TAB, showProductTab } from './product-tab-ids';

/** Mirrors the API's per-line cap (backend `MAX_LINE_QUANTITY`); the server enforces it. */
const MAX_QUANTITY = 10;

const focusRing =
  'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring';

const legendClass = 'mb-3 text-sm text-muted-foreground';

const AVAILABILITY_COPY: Record<Availability, string> = {
  in_stock: 'In stock',
  low_stock: 'Only a few left',
  out_of_stock: 'Sold out',
};

function initialColor(product: ProductDetail): string | null {
  // Open on a colour that can actually be bought, if there is one.
  const buyable = product.variants.find((variant) => variant.availability !== 'out_of_stock');
  return buyable?.color ?? product.colors[0] ?? null;
}

/**
 * Whole-percent saving between two server prices, for the badge only — nothing is charged
 * from it. `null` when there is no real saving to show.
 */
function percentOff(priceMinor: number, compareAtMinor: number | null): number | null {
  if (compareAtMinor === null || compareAtMinor <= priceMinor) return null;
  const percent = Math.round(((compareAtMinor - priceMinor) / compareAtMinor) * 100);
  return percent > 0 ? percent : null;
}

/**
 * Price, colour, size, quantity and "Add to bag" for one product.
 *
 * What is sent to the cart is the id of exactly one variant: the one whose colour AND size
 * match the selection. Until that resolves to a single variant, the button says what is
 * missing instead of adding the parent product. The server then decides whether that variant
 * can be sold, at what price and in what quantity — this component never sends a price.
 */
export function ProductPurchase({ product }: { product: ProductDetail }) {
  const router = useRouter();
  const addToCart = useAddToCart();
  const colorGroupId = useId();
  const sizeGroupId = useId();

  const [color, setColor] = useState<string | null>(() => initialColor(product));
  const [size, setSize] = useState<string | null>(null);
  const [quantity, setQuantity] = useState(1);

  const forColor = product.variants.filter((variant) => variant.color === color);
  const sizes = forColor
    .map((variant) => variant.size)
    .filter((value): value is string => value !== null);
  const needsSize = sizes.length > 0;
  // A single size is not a choice; select it rather than make the customer click it.
  const effectiveSize = needsSize && sizes.length === 1 ? (sizes[0] ?? null) : size;

  const selected: ProductVariant | undefined = needsSize
    ? forColor.find((variant) => variant.size === effectiveSize)
    : forColor[0];

  const soldOut = selected?.availability === 'out_of_stock';

  const add = useAsyncAction(
    (variantId: string) => addToCart.mutateAsync({ variantId, quantity }),
    {
      onSuccess: () => {
        toast.success('Added to your bag', {
          action: {
            label: 'View bag',
            onClick: () => {
              router.push('/cart');
            },
          },
        });
      },
      onError: (error) => {
        // Stock or publication changed since this page rendered: show the current truth.
        if (
          isApiError(error) &&
          (error.code === ApiErrorCode.OUT_OF_STOCK || error.code === ApiErrorCode.NOT_FOUND)
        ) {
          router.refresh();
        }
      },
    },
  );

  const price = selected
    ? formatMoney(selected.priceMinor, product.currency)
    : formatPriceRange(product.priceMinor, product.maxPriceMinor, product.currency);
  const compareAt =
    selected?.compareAtPriceMinor ?? (selected ? null : product.compareAtPriceMinor);
  const saving = percentOff(selected?.priceMinor ?? product.priceMinor, compareAt);

  const buttonLabel = add.isPending
    ? 'Adding…'
    : !selected
      ? needsSize
        ? 'Select a size'
        : 'Unavailable'
      : soldOut
        ? 'Sold out'
        : 'Add to bag';

  return (
    <div className="flex flex-col gap-6">
      <p className="flex flex-wrap items-center gap-x-3 gap-y-2 tabular-nums">
        <span className="text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{price}</span>
        {compareAt ? (
          <s className="text-base text-muted-foreground">
            <span className="sr-only">Was </span>
            {formatMoney(compareAt, product.currency)}
          </s>
        ) : null}
        {saving ? (
          <span className="rounded-sm bg-foreground px-2 py-1 text-[11px] font-semibold tracking-wide text-background uppercase">
            {saving}% off
          </span>
        ) : null}
      </p>

      {product.colors.length > 0 ? (
        <fieldset>
          <legend id={colorGroupId} className={legendClass}>
            Colour: <span className="font-medium text-foreground">{color ?? '—'}</span>
          </legend>
          <div className="flex flex-wrap gap-3">
            {product.colors.map((option) => (
              <label key={option} className="cursor-pointer" title={option}>
                <input
                  type="radio"
                  name={colorGroupId}
                  value={option}
                  checked={color === option}
                  onChange={() => {
                    setColor(option);
                    setSize(null);
                  }}
                  className="peer sr-only"
                />
                <span
                  className={cn(
                    'grid size-10 place-items-center rounded-full border-2 transition-colors',
                    'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                    color === option
                      ? 'border-foreground'
                      : 'border-transparent hover:border-foreground/30',
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="size-7 rounded-full ring-1 ring-foreground/15"
                    style={{ backgroundColor: swatchFill(option) }}
                  />
                  <span className="sr-only">{option}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      ) : null}

      {needsSize ? (
        // The link sits outside the fieldset: a <legend> must be its first child, and a
        // fieldset's box starts halfway down the legend, which would misplace `top-0`.
        <div className="relative">
          <fieldset>
            <legend id={sizeGroupId} className={legendClass}>
              Size
              {effectiveSize ? (
                <>
                  : <span className="font-medium text-foreground">{effectiveSize}</span>
                </>
              ) : null}
            </legend>
            <div className="flex flex-wrap gap-2">
              {forColor.map((variant) => {
                if (variant.size === null) return null;
                const unavailable = variant.availability === 'out_of_stock';
                return (
                  <label
                    key={variant.id}
                    className={cn(unavailable ? 'cursor-not-allowed' : 'cursor-pointer')}
                  >
                    <input
                      type="radio"
                      name={sizeGroupId}
                      value={variant.size}
                      checked={effectiveSize === variant.size}
                      disabled={unavailable}
                      onChange={() => {
                        setSize(variant.size);
                        setQuantity(1);
                      }}
                      className="peer sr-only"
                    />
                    <span
                      className={cn(
                        'grid h-11 min-w-14 place-items-center rounded-md border px-3 text-sm font-medium tabular-nums transition-colors',
                        'peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-ring',
                        effectiveSize === variant.size
                          ? 'border-foreground bg-foreground text-background'
                          : 'border-border hover:border-foreground/60',
                        unavailable &&
                          'border-dashed font-normal text-muted-foreground line-through hover:border-border',
                      )}
                    >
                      {variant.size}
                      {unavailable ? <span className="sr-only"> (sold out)</span> : null}
                    </span>
                  </label>
                );
              })}
            </div>
          </fieldset>
          <a
            href={`#${SIZE_AND_FIT_TAB}`}
            onClick={(event) => {
              event.preventDefault();
              showProductTab(SIZE_AND_FIT_TAB);
            }}
            className={cn(
              'absolute top-0 right-0 flex items-center gap-1.5 text-sm underline-offset-4 hover:underline',
              focusRing,
            )}
          >
            <RulerIcon className="size-4" aria-hidden="true" />
            Size guide
          </a>
        </div>
      ) : null}

      <div className="flex flex-col gap-3">
        <p
          aria-live="polite"
          className={cn(
            'flex items-center gap-2 text-xs tracking-wide',
            selected?.availability === 'low_stock' && 'text-foreground',
            (soldOut || !selected) && 'text-muted-foreground',
          )}
        >
          {selected && !soldOut ? (
            <span
              aria-hidden="true"
              className={cn(
                'size-1.5 rounded-full',
                selected.availability === 'low_stock' ? 'bg-amber-500' : 'bg-success',
              )}
            />
          ) : null}
          {selected
            ? AVAILABILITY_COPY[selected.availability]
            : needsSize
              ? 'Choose a size to see availability.'
              : 'This item is not available.'}
        </p>

        <div className="flex items-stretch gap-3">
          <div
            className="flex items-center rounded-md border border-border"
            role="group"
            aria-label="Quantity"
          >
            <button
              type="button"
              aria-label="Decrease quantity"
              disabled={quantity <= 1}
              onClick={() => {
                setQuantity((value) => Math.max(1, value - 1));
              }}
              className={cn(
                'grid h-12 w-10 place-items-center rounded-l-md disabled:opacity-30',
                focusRing,
              )}
            >
              <MinusIcon className="size-3.5" aria-hidden="true" />
            </button>
            <output aria-live="polite" className="w-7 text-center text-sm tabular-nums">
              {quantity}
            </output>
            <button
              type="button"
              aria-label="Increase quantity"
              disabled={quantity >= MAX_QUANTITY}
              onClick={() => {
                setQuantity((value) => Math.min(MAX_QUANTITY, value + 1));
              }}
              className={cn(
                'grid h-12 w-10 place-items-center rounded-r-md disabled:opacity-30',
                focusRing,
              )}
            >
              <PlusIcon className="size-3.5" aria-hidden="true" />
            </button>
          </div>

          <button
            type="button"
            disabled={!selected || soldOut || add.isPending}
            onClick={() => {
              if (selected) void add.run(selected.id);
            }}
            className={cn(
              'flex h-12 flex-1 items-center justify-center gap-2.5 rounded-md bg-foreground px-6 text-sm font-semibold text-background transition-opacity',
              'hover:opacity-85 disabled:cursor-not-allowed disabled:opacity-40',
              focusRing,
            )}
          >
            <ShoppingBagIcon className="size-4" aria-hidden="true" />
            {buttonLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
