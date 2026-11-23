import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { OrdersList } from '@/components/admin/orders/orders-list';

export const metadata: Metadata = { title: 'Orders' };

export default function AdminOrdersPage() {
  return (
    <AdminPage path="/admin/orders">
      <OrdersList />
    </AdminPage>
  );
}
