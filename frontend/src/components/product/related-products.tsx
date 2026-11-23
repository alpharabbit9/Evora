import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { ProductCard, ProductCardSkeleton } from '@/components/catalog/product-card';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { BatchReveal } from '@/components/storefront/scroll-motion';
import { SectionHeading } from '@/components/storefront/section-heading';
import { Skeleton } from '@/components/ui/skeleton';
import { fetchProducts } from '@/lib/catalog/api';
import type { CategoryRef, ProductCard as ProductCardData } from '@/lib/catalog/types';

const COUNT = 4;

const GRID = 'grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-4 xl:gap-x-6';

const HEADING_ID = 'related-products';

/**
 * Other published products from the same category, topped up from its parent when the
 * category alone is too small to fill the row. Ordered by the API's "featured" sort — there
 * is no recommendation model behind this (PRD non-goals).
 *
 * Supplementary to the page: a failed read renders nothing rather than an error, so the
 * product itself stays buyable.
 *
 * Motion (pages-plan.md P4), the same as the home page's Dark Edit: the inline heading's title
 * rises and its rule draws when the section scrolls in (`RevealGroup`), and the cards' photos
 * wipe up into their frames (`BatchReveal effect="clip"`). Both are GSAP, once; reduced motion
 * fades.
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
    <section aria-labelledby={HEADING_ID} className="border-t border-border pt-12 sm:pt-16">
      <RevealGroup>
        <RevealItem>
          <SectionHeading
            variant="inline"
            id={HEADING_ID}
            title="You may also like"
            aside={`more ${category.name.toLowerCase()}`}
            action={
              // The underline sweeps in from the left on hover, as on the home page's links.
              <Link
                href={`/shop?category=${category.slug}`}
                className="group tap-target inline-flex shrink-0 items-center gap-2.5 border-b border-foreground/25 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase after:absolute after:inset-x-0 after:-bottom-px after:h-px after:origin-right after:scale-x-0 after:bg-foreground after:transition-transform after:duration-500 after:ease-[cubic-bezier(0.16,1,0.3,1)] hover:after:origin-left hover:after:scale-x-100 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring motion-reduce:after:transition-none"
              >
                View all
                <span className="sr-only"> {category.name}</span>
                <ArrowRight
                  aria-hidden="true"
                  strokeWidth={1.5}
                  className="size-3.5 transition-transform duration-500 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 motion-reduce:transition-none"
                />
              </Link>
            }
          />
        </RevealItem>
      </RevealGroup>

      <BatchReveal as="ul" effect="clip" className={`mt-8 sm:mt-10 ${GRID}`}>
        {products.map((product) => (
          <li key={product.id}>
            <ProductCard product={product} />
          </li>
        ))}
      </BatchReveal>
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
