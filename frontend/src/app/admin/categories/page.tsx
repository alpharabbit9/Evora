import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { CategoriesList } from '@/components/admin/categories/categories-list';

export const metadata: Metadata = { title: 'Categories' };

export default function AdminCategoriesPage() {
  return (
    <AdminPage path="/admin/categories">
      <CategoriesList />
    </AdminPage>
  );
}
