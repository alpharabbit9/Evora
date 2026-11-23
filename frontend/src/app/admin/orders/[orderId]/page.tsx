import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { OrderDetailScreen } from '@/components/admin/orders/order-detail';

export const metadata: Metadata = { title: 'Order' };

export default function AdminOrderPage({ params }: PageProps<'/admin/orders/[orderId]'>) {
  const orderId = params.then((resolved) => resolved.orderId);

  return (
    <AdminPage path={orderId.then((id) => `/admin/orders/${encodeURIComponent(id)}`)}>
      {orderId.then((id) => (
        <OrderDetailScreen orderId={id} />
      ))}
    </AdminPage>
  );
}
