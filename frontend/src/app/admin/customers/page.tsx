import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { CustomersList } from '@/components/admin/customers/customers-list';

export const metadata: Metadata = { title: 'Customers' };

export default function AdminCustomersPage() {
  return (
    <AdminPage path="/admin/customers">
      <CustomersList />
    </AdminPage>
  );
}
