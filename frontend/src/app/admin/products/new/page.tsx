import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { AdminPageHeader } from '@/components/admin/admin-ui';
import { ProductForm } from '@/components/admin/products/product-form';

export const metadata: Metadata = { title: 'New product' };

export default function AdminNewProductPage() {
  return (
    <AdminPage path="/admin/products/new">
      <div className="flex flex-col gap-6">
        <AdminPageHeader
          back={{ href: '/admin/products', label: 'Products' }}
          title="New product"
          description="It is saved as a draft. Add variants and images, then publish it."
        />
        <ProductForm />
      </div>
    </AdminPage>
  );
}
