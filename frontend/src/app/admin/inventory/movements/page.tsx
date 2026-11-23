import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { MovementsList } from '@/components/admin/inventory/movements-list';

export const metadata: Metadata = { title: 'Stock history' };

export default function AdminMovementsPage() {
  return (
    <AdminPage path="/admin/inventory/movements">
      <MovementsList />
    </AdminPage>
  );
}
