import { PageTransition } from '@/components/layout/page-transition';
import { ProductSkeleton } from '@/components/product/product-skeleton';

export default function ProductLoading() {
  return (
    <PageTransition>
      <ProductSkeleton />
    </PageTransition>
  );
}
