import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { SettingsPage } from '@/components/admin/settings/settings-form';

export const metadata: Metadata = { title: 'Settings' };

export default function AdminSettingsPagePage() {
  return (
    <AdminPage path="/admin/settings">
      <SettingsPage />
    </AdminPage>
  );
}
