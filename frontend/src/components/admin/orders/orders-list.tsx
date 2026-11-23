'use client';

import { ReceiptTextIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ADMIN_PAGE_SIZE, useAdminOrders } from '@/lib/admin/api';
import { useListParams } from '@/lib/admin/use-list-params';
import type { OrderPaymentStatus, OrderStatus } from '@/lib/checkout/types';
import { formatMoney } from '@/lib/money';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  FilterBar,
  FilterSelect,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
} from '../admin-ui';
import { ExportOrders } from './export-orders';
import { ORDER_PAYMENT_ADMIN, ORDER_STATUS_ADMIN } from './order-labels';

const STATUSES = Object.keys(ORDER_STATUS_ADMIN) as OrderStatus[];
const PAYMENT_STATUSES = Object.keys(ORDER_PAYMENT_ADMIN) as OrderPaymentStatus[];
const METHODS = ['COD', 'ONLINE'] as const;

/** Newest first. Filters live in the URL, so a view can be bookmarked or sent to a colleague. */
export function OrdersList() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    status: params.getOneOf('status', STATUSES),
    paymentStatus: params.getOneOf('paymentStatus', PAYMENT_STATUSES),
    paymentMethod: params.getOneOf('paymentMethod', METHODS),
  };
  const orders = useAdminOrders(filters);
  const filtered = Boolean(
    filters.q ?? filters.status ?? filters.paymentStatus ?? filters.paymentMethod,
  );

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Orders"
        description="Move orders through fulfilment, record cash collected, refund, and decide held payments."
        action={<ExportOrders status={filters.status} />}
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="Order number or email"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="Status"
          value={filters.status}
          onChange={(status) => {
            params.set({ status });
          }}
          options={STATUSES.map((value) => ({ value, label: ORDER_STATUS_ADMIN[value].label }))}
        />
        <FilterSelect
          label="Payment"
          value={filters.paymentStatus}
          onChange={(paymentStatus) => {
            params.set({ paymentStatus });
          }}
          options={PAYMENT_STATUSES.map((value) => ({
            value,
            label: ORDER_PAYMENT_ADMIN[value].label,
          }))}
        />
        <FilterSelect
          label="Method"
          value={filters.paymentMethod}
          onChange={(paymentMethod) => {
            params.set({ paymentMethod });
          }}
          options={[
            { value: 'COD', label: 'Cash on delivery' },
            { value: 'ONLINE', label: 'Online' },
          ]}
        />
      </FilterBar>

      <AdminQueryState
        query={orders}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load orders"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<ReceiptTextIcon className="size-6" strokeWidth={1.25} />}
            title={filtered ? 'No orders match these filters' : 'No orders yet'}
            {...(filtered ? { description: 'Try a different search or clear a filter.' } : {})}
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Orders" stale={orders.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Order
                  </th>
                  <th scope="col" className={TH}>
                    Placed
                  </th>
                  <th scope="col" className={TH}>
                    Customer
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Items
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total
                  </th>
                  <th scope="col" className={TH}>
                    Status
                  </th>
                  <th scope="col" className={TH}>
                    Payment
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((order) => (
                  <tr key={order.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <Link
                        href={`/admin/orders/${order.id}`}
                        className={`font-mono text-xs font-medium underline-offset-4 hover:underline ${focusRing}`}
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDateTime(order.placedAt)}
                    </td>
                    <td className={`${TD} max-w-56 truncate`} title={order.contactEmail}>
                      {order.contactEmail}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>{order.itemCount}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {formatMoney(order.totalMinor, order.currency)}
                    </td>
                    <td className={TD}>
                      <Badge tone={ORDER_STATUS_ADMIN[order.status].tone}>
                        {ORDER_STATUS_ADMIN[order.status].label}
                      </Badge>
                    </td>
                    <td className={TD}>
                      <Badge tone={ORDER_PAYMENT_ADMIN[order.paymentStatus].tone}>
                        {ORDER_PAYMENT_ADMIN[order.paymentStatus].label}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="orders"
            />
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
