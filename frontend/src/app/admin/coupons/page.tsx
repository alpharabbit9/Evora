import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { CouponsList } from '@/components/admin/coupons/coupons-list';

export const metadata: Metadata = { title: 'Coupons' };

export default function AdminCouponsListPage() {
  return (
    <AdminPage path="/admin/coupons">
      <CouponsList />
    </AdminPage>
  );
}
