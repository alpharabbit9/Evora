import type { Metadata } from 'next';
import { Suspense } from 'react';

import { AdminOnly } from '@/components/admin/admin-only';
import { AdminShell } from '@/components/admin/admin-shell';
import { AdminGateSkeleton } from '@/components/admin/admin-skeleton';

export const metadata: Metadata = {
  title: { default: 'Admin', template: '%s — EVORA Admin' },
  robots: { index: false, follow: false },
};

/**
 * The dashboard sits outside the `(store)` group, so it has none of the storefront's chrome
 * (architecture.md §6). Nothing of the dashboard, not even its navigation, renders until
 * `AdminOnly` has asked the API who this is and what they may do.
 *
 * A visitor who is not an administrator gets the page without the shell, and every page runs its
 * own `AdminOnly`, which refuses them: so they see the refusal, and only once.
 */
export default function AdminLayout({ children }: LayoutProps<'/admin'>) {
  return (
    <Suspense fallback={<AdminGateSkeleton />}>
      <AdminOnly path="/admin" refused={children}>
        {(user) => <AdminShell userEmail={user.email}>{children}</AdminShell>}
      </AdminOnly>
    </Suspense>
  );
}
