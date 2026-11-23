import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { ProductsList } from '@/components/admin/products/products-list';

export const metadata: Metadata = { title: 'Products' };

export default function AdminProductsPage() {
  return (
    <AdminPage path="/admin/products">
      <ProductsList />
    </AdminPage>
  );
}
