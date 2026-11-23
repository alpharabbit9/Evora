import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { InventoryList } from '@/components/admin/inventory/inventory-list';

export const metadata: Metadata = { title: 'Inventory' };

export default function AdminInventoryPage() {
  return (
    <AdminPage path="/admin/inventory">
      <InventoryList />
    </AdminPage>
  );
}
