import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { ProductDetailScreen } from '@/components/admin/products/product-detail';

export const metadata: Metadata = { title: 'Product' };

export default function AdminProductPage({ params }: PageProps<'/admin/products/[productId]'>) {
  const productId = params.then((resolved) => resolved.productId);

  return (
    <AdminPage path={productId.then((id) => `/admin/products/${encodeURIComponent(id)}`)}>
      {productId.then((id) => (
        <ProductDetailScreen productId={id} />
      ))}
    </AdminPage>
  );
}
