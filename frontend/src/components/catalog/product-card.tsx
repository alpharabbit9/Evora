import { ArrowUpRight } from 'lucide-react';
import Link from 'next/link';

import { ClipReveal } from '@/components/storefront/clip-reveal';
import { Skeleton } from '@/components/ui/skeleton';
import { WishlistButton } from '@/components/wishlist/wishlist-button';
import type { ProductCard as ProductCardData } from '@/lib/catalog/types';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

import { ColorSwatch } from './color-swatch';
import { ProductImage } from './product-image';

const GENDER_LABEL = { men: 'Men', women: 'Women', unisex: 'Unisex' } as const;

/** Swatches shown before the rest collapse into "+n". */
const MAX_SWATCHES = 4;

/** Card widths at each grid breakpoint (2 → 3 → 4 columns), for `next/image`. */
export const CARD_IMAGE_SIZES = '(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw';

/** The store's own name. A card in a curated section does not repeat it on every product. */
const STORE_BRAND = 'EVORA';

/** The theme's `--ease-out`, for every hover movement on the card. */
const EASE = 'ease-[cubic-bezier(0.16,1,0.3,1)]';

/**
 * One product in a listing. The card's content is a single link to the product page, so it is
 * one tab stop and one announcement rather than a cluster of nested links. The wishlist heart
 * is the second stop: a button cannot sit inside a link, so it is a sibling laid over the
 * image's corner.
 *
 * Hover (and keyboard focus inside the card) slowly pushes into the photo and raises a
 * "View product" bar from the image's foot. (There is no sheen sweep: plan.md Phase 4 removed
 * it from every variant.) All of it is CSS on
 * elements inside the card, so a wrapper that animates the card's entrance (`BatchReveal`,
 * `RevealItem`) keeps sole ownership of the card's own opacity and transform. The bar is
 * decoration for the link it sits in (`aria-hidden`), not a second control, and on touch
 * screens, which have no hover, it simply never shows. Reduced motion keeps the fades and
 * drops the movement.
 *
 * Prices and the sale mark are display copies of the server's numbers (ADR 0008).
 *
 * Variants:
 * - `default`: the catalog card, as `/shop`, search, related products and the wishlist use it.
 * - `editorial`: for curated home-page sections. It drops metadata that says nothing there: the
 *   brand when it is the store's own (every product is), and the swatch row when there is only
 *   one colour. The colours stay announced to screen readers either way.
 *
 * `feature` makes the card fill a taller grid cell (the Dark Edit's lead tile): from the given
 * breakpoint (`md` or `lg`, wherever the grid makes the cell two rows tall) the photo stretches
 * to the cell instead of keeping 4:5, and the name is set larger at every size. Pass `sizes`
 * for its wider image.
 */
export function ProductCard({
  product,
  preload,
  variant = 'default',
  feature,
  sizes = CARD_IMAGE_SIZES,
}: {
  product: ProductCardData;
  preload?: boolean;
  variant?: 'default' | 'editorial';
  feature?: 'md' | 'lg';
  sizes?: string;
}) {
  const hasRange = product.maxPriceMinor !== product.priceMinor;
  const onSale =
    product.compareAtPriceMinor !== null && product.compareAtPriceMinor > product.priceMinor;
  const extraColors = product.colors.length - MAX_SWATCHES;
  const editorial = variant === 'editorial';
  const brand =
    editorial && product.brand?.trim().toUpperCase() === STORE_BRAND ? null : product.brand;
  const showSwatches = editorial ? product.colors.length > 1 : product.colors.length > 0;

  return (
    <div className={cn('group relative', feature && 'h-full')}>
      <Link
        href={`/products/${product.slug}`}
        className={cn(
          'flex flex-col gap-4 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring',
          feature && 'h-full',
        )}
      >
        <div
          className={cn(
            'relative isolate overflow-hidden rounded-md bg-muted ring-1 ring-foreground/5 transition-shadow duration-500 group-hover:shadow-lg group-hover:shadow-foreground/10',
            feature === 'md' && 'aspect-[4/5] md:aspect-auto md:min-h-0 md:flex-1',
            feature === 'lg' && 'aspect-[4/5] lg:aspect-auto lg:min-h-0 lg:flex-1',
            !feature && 'aspect-[3/4]',
          )}
        >
          {/* The photo's own layer, for a clip entrance (the Dark Edit's `BatchReveal
              effect="clip"`); inert everywhere else. The zoom stays on the image inside it. */}
          <ClipReveal className="absolute inset-0">
            <ProductImage
              image={product.image}
              sizes={sizes}
              {...(preload ? { preload } : {})}
              className={cn(
                'transition-[scale] duration-[900ms] group-focus-within:scale-[1.06] group-hover:scale-[1.06]',
                EASE,
                'motion-reduce:transition-none motion-reduce:group-focus-within:scale-100 motion-reduce:group-hover:scale-100',
                !product.inStock && 'grayscale-[0.6]',
              )}
            />
          </ClipReveal>

          {/* Shade under the bar, so it reads on a light photo. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-1/3 bg-linear-to-t from-black/35 to-transparent opacity-0 transition-opacity duration-500 group-focus-within:opacity-100 group-hover:opacity-100"
          />

          <span className="absolute top-3 left-3 flex flex-col items-start gap-1.5">
            {!product.inStock ? (
              <Badge className="bg-background/90 text-foreground">Sold out</Badge>
            ) : onSale ? (
              <Badge className="bg-foreground text-background">
                {hasRange || !product.compareAtPriceMinor
                  ? 'Sale'
                  : `−${String(Math.round((1 - product.priceMinor / product.compareAtPriceMinor) * 100))}%`}
              </Badge>
            ) : null}
          </span>

          <span
            aria-hidden="true"
            className={cn(
              'absolute inset-x-3 bottom-3 flex h-11 items-center justify-between rounded-full bg-background/95 px-5 text-[10px] font-semibold tracking-[0.22em] text-foreground uppercase shadow-sm backdrop-blur-sm',
              'translate-y-[calc(100%+1rem)] opacity-0 transition-[translate,opacity] duration-500',
              EASE,
              'group-focus-within:translate-y-0 group-focus-within:opacity-100 group-hover:translate-y-0 group-hover:opacity-100',
              'motion-reduce:translate-y-0',
            )}
          >
            View product
            <ArrowUpRight
              strokeWidth={1.75}
              className={cn(
                'size-4 transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5',
                EASE,
              )}
            />
          </span>
        </div>

        <div className="flex flex-col gap-1.5 px-0.5">
          <p className="flex items-center justify-between gap-3 text-[10px] font-semibold tracking-[0.2em] text-muted-foreground uppercase">
            <span className="truncate">{brand ?? product.category.name}</span>
            {product.gender ? (
              <span className="shrink-0">{GENDER_LABEL[product.gender]}</span>
            ) : null}
          </p>
          <h3
            className={cn(
              'line-clamp-2 leading-snug text-foreground/85 transition-colors duration-300 group-hover:text-foreground',
              feature ? 'font-heading text-[clamp(1.25rem,1.1rem+0.6vw,1.625rem)]' : 'text-sm',
            )}
          >
            {/* An underline that draws in under the name on hover. */}
            <span className="bg-linear-to-r from-current to-current bg-[length:0%_1px] bg-left-bottom bg-no-repeat transition-[background-size] duration-500 group-hover:bg-[length:100%_1px] motion-reduce:transition-none">
              {product.name}
            </span>
          </h3>
          <div className="mt-1 flex items-end justify-between gap-3">
            <p className="flex flex-wrap items-baseline gap-x-2 text-sm font-semibold tabular-nums">
              <span>
                {hasRange ? (
                  <span className="text-xs font-normal text-muted-foreground">From </span>
                ) : null}
                {formatMoney(product.priceMinor, product.currency)}
              </span>
              {onSale && product.compareAtPriceMinor ? (
                <s className="text-xs font-normal text-muted-foreground">
                  <span className="sr-only">Was </span>
                  {formatMoney(product.compareAtPriceMinor, product.currency)}
                </s>
              ) : null}
            </p>
            {showSwatches ? (
              <p className="flex shrink-0 items-center gap-1 text-[11px] text-muted-foreground">
                {product.colors.slice(0, MAX_SWATCHES).map((color) => (
                  <ColorSwatch key={color} color={color} />
                ))}
                {extraColors > 0 ? (
                  <span aria-hidden="true" className="tabular-nums">
                    +{extraColors}
                  </span>
                ) : null}
                <span className="sr-only">Colours: {product.colors.join(', ')}</span>
              </p>
            ) : product.colors.length > 0 ? (
              <span className="sr-only">Colour: {product.colors.join(', ')}</span>
            ) : null}
          </div>
        </div>
      </Link>
      <WishlistButton product={product} className="absolute top-3 right-3" />
    </div>
  );
}

function Badge({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <span
      className={cn(
        'rounded-full px-2.5 py-1 text-[9px] font-semibold tracking-[0.2em] uppercase shadow-sm',
        className,
      )}
    >
      {children}
    </span>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-4" aria-hidden="true">
      <Skeleton className="aspect-[3/4] w-full rounded-md" />
      <div className="flex flex-col gap-2 px-0.5">
        <Skeleton className="h-3 w-1/3" />
        <Skeleton className="h-4 w-4/5" />
        <Skeleton className="h-4 w-1/4" />
      </div>
    </div>
  );
}

export const PRODUCT_GRID =
  'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4 xl:gap-x-6 xl:gap-y-12';

export function ProductGridSkeleton({ count = 8 }: { count?: number }) {
  return (
    <div role="status" aria-live="polite">
      <div className={PRODUCT_GRID}>
        {Array.from({ length: count }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
      <span className="sr-only">Loading products</span>
    </div>
  );
}
