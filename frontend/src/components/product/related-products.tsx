import { ArrowRightIcon } from 'lucide-react';
import Link from 'next/link';

import { ProductCard, ProductCardSkeleton } from '@/components/catalog/product-card';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProducts } from '@/lib/catalog/api';
import type { CategoryRef, ProductCard as ProductCardData } from '@/lib/catalog/types';

const COUNT = 4;

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 xl:gap-x-6';

/**
 * Other published products from the same category, topped up from its parent when the
 * category alone is too small to fill the row. Ordered by the API's "featured" sort — there
 * is no recommendation model behind this (PRD non-goals).
 *
 * Supplementary to the page: a failed read renders nothing rather than an error, so the
 * product itself stays buyable.
 */
async function loadRelated(
  slug: string,
  category: CategoryRef & { parent: CategoryRef | null },
): Promise<ProductCardData[]> {
  const picked = new Map<string, ProductCardData>();
  const scopes = [category.slug, ...(category.parent ? [category.parent.slug] : [])];

  for (const scope of scopes) {
    const page = await fetchProducts({ category: scope, sort: 'featured', pageSize: COUNT + 1 });
    for (const item of page.items) {
      if (item.slug !== slug && picked.size < COUNT) picked.set(item.id, item);
    }
    if (picked.size >= COUNT) break;
  }

  return [...picked.values()];
}

export async function RelatedProducts({
  slug,
  category,
}: {
  slug: string;
  category: CategoryRef & { parent: CategoryRef | null };
}) {
  const products = await loadRelated(slug, category).catch(() => []);

  if (products.length === 0) {
    return null;
  }

  return (
    <section aria-labelledby="related-products" className="border-t border-border pt-12 sm:pt-16">
      <div className="flex items-end justify-between gap-4">
        <h2
          id="related-products"
          className="font-heading text-[clamp(1.5rem,1.2rem+1vw,2.1rem)] leading-tight font-normal"
        >
          You may also like
        </h2>
        <Link
          href={`/shop?category=${category.slug}`}
          className="flex shrink-0 items-center gap-1.5 text-sm underline-offset-4 hover:underline focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
        >
          View all
          <span className="sr-only"> {category.name}</span>
          <ArrowRightIcon className="size-4" aria-hidden="true" />
        </Link>
      </div>

      <div className={`mt-8 ${GRID}`}>
        {products.map((product) => (
          <ProductCard key={product.id} product={product} />
        ))}
      </div>
    </section>
  );
}

export function RelatedProductsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="border-t border-border pt-12 sm:pt-16">
      <Skeleton className="h-8 w-56" />
      <div className={`mt-8 ${GRID}`}>
        {Array.from({ length: COUNT }, (_, index) => (
          <ProductCardSkeleton key={index} />
        ))}
      </div>
      <span className="sr-only">Loading related products</span>
    </div>
  );
}
