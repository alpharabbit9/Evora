import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { AuditLog } from '@/components/admin/audit/audit-log';

export const metadata: Metadata = { title: 'Audit log' };

export default function AdminAuditLogPage() {
  return (
    <AdminPage path="/admin/audit">
      <AuditLog />
    </AdminPage>
  );
}
