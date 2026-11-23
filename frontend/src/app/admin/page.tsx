import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { Overview } from '@/components/admin/overview/overview';

export const metadata: Metadata = { title: 'Overview' };

/** The dashboard's front page: what sold, for a date range (M10, ADR 0022). */
export default function AdminHome() {
  return (
    <AdminPage path="/admin">
      <Overview />
    </AdminPage>
  );
}
