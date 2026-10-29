'use client';

import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';

import { PRODUCT_GRID, ProductCard, ProductGridSkeleton } from '@/components/catalog/product-card';
import { EmptyState } from '@/components/common/empty-state';
import { ErrorState } from '@/components/common/error-state';
import { catalogKeys, fetchProducts, type ProductQuery } from '@/lib/catalog/api';

/** The first eight front-runners: exactly what `/shop` opens with, so the two never disagree. */
const QUERY: ProductQuery = { sort: 'featured', page: 1, pageSize: 8 };

export function DarkEditGrid() {
  const products = useQuery({
    queryKey: catalogKeys.products(QUERY),
    queryFn: ({ signal }) => fetchProducts(QUERY, signal),
  });

  if (products.isPending) return <ProductGridSkeleton count={8} />;

  if (products.isError) {
    return (
      <ErrorState
        error={products.error}
        title="We couldn't load the edit"
        onRetry={() => {
          void products.refetch();
        }}
      />
    );
  }

  if (products.data.items.length === 0) {
    return (
      <EmptyState
        title="The edit is being restocked"
        description="Everything else in the collection is still a click away."
        action={
          <Link
            href="/shop"
            className="border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground"
          >
            Browse the collection
          </Link>
        }
      />
    );
  }

  return (
    <ul className={PRODUCT_GRID}>
      {/* Below the hero, so the images load lazily; none is the page's largest paint. */}
      {products.data.items.map((product) => (
        <li key={product.id}>
          <ProductCard product={product} />
        </li>
      ))}
    </ul>
  );
}
