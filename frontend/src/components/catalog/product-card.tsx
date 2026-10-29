import Link from 'next/link';

import { Skeleton } from '@/components/ui/skeleton';
import type { ProductCard as ProductCardData } from '@/lib/catalog/types';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

import { ColorSwatch } from './color-swatch';
import { ProductImage } from './product-image';

const GENDER_LABEL = { men: 'Men', women: 'Women', unisex: 'Unisex' } as const;

/** Card widths at each grid breakpoint (2 → 3 → 4 columns), for `next/image`. */
export const CARD_IMAGE_SIZES = '(min-width: 1280px) 22vw, (min-width: 768px) 30vw, 48vw';

/**
 * One product in a listing. The whole card is a single link to the product page, so it is
 * one tab stop and one announcement rather than a cluster of nested links.
 */
export function ProductCard({ product, preload }: { product: ProductCardData; preload?: boolean }) {
  const hasRange = product.maxPriceMinor !== product.priceMinor;

  return (
    <Link
      href={`/products/${product.slug}`}
      className="group flex flex-col gap-3 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
    >
      <div className="relative aspect-[3/4] overflow-hidden bg-muted">
        <ProductImage
          image={product.image}
          sizes={CARD_IMAGE_SIZES}
          {...(preload ? { preload } : {})}
          className="transition-transform duration-700 ease-out group-hover:scale-[1.03] motion-reduce:transition-none"
        />
        {!product.inStock ? (
          <span className="absolute top-3 left-3 bg-background/90 px-2 py-1 text-[9px] font-semibold tracking-[0.2em] text-foreground uppercase">
            Sold out
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-1">
        <p className="flex items-center justify-between gap-3 text-[10px] font-semibold tracking-[0.18em] text-muted-foreground uppercase">
          <span className="truncate">{product.brand ?? product.category.name}</span>
          {product.gender ? <span className="shrink-0">{GENDER_LABEL[product.gender]}</span> : null}
        </p>
        <h3 className="line-clamp-2 text-sm leading-snug text-foreground/90 group-hover:text-foreground">
          {product.name}
        </h3>
        <p className="mt-0.5 flex items-baseline gap-2 text-sm font-medium tabular-nums">
          <span>
            {hasRange ? 'From ' : ''}
            {formatMoney(product.priceMinor, product.currency)}
          </span>
          {product.compareAtPriceMinor ? (
            <s className="text-xs font-normal text-muted-foreground">
              {formatMoney(product.compareAtPriceMinor, product.currency)}
            </s>
          ) : null}
        </p>
        {product.colors.length > 0 ? (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
            {product.colors.slice(0, 4).map((color) => (
              <ColorSwatch key={color} color={color} />
            ))}
            <span className={cn(product.colors.length > 1 && 'sr-only')}>
              {product.colors.join(', ')}
            </span>
          </p>
        ) : null}
      </div>
    </Link>
  );
}

export function ProductCardSkeleton() {
  return (
    <div className="flex flex-col gap-3" aria-hidden="true">
      <Skeleton className="aspect-[3/4] w-full rounded-none" />
      <Skeleton className="h-3 w-1/3" />
      <Skeleton className="h-4 w-4/5" />
      <Skeleton className="h-4 w-1/4" />
    </div>
  );
}

export const PRODUCT_GRID =
  'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 xl:grid-cols-4 xl:gap-x-6';

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
