import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { JobsList } from '@/components/admin/jobs/jobs-list';

export const metadata: Metadata = { title: 'Emails & jobs' };

export default function AdminJobsPage() {
  return (
    <AdminPage path="/admin/jobs">
      <JobsList />
    </AdminPage>
  );
}
