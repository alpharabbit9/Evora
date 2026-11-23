'use client';

import { PackageIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { ACCOUNT_SECTION_TITLE } from '@/components/account/account-form';
import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { Skeleton } from '@/components/ui/skeleton';
import { ORDERS_PAGE_SIZE, useOrders } from '@/lib/checkout/use-checkout';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

import { ORDER_STATUS_LABEL, formatOrderDate } from './order-format';

function OrdersSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <Skeleton aria-hidden="true" className="h-14 w-full" />
      <Skeleton aria-hidden="true" className="h-14 w-full" />
      <span className="sr-only">Loading your orders</span>
    </div>
  );
}

/**
 * The way back to an order once its confirmation page is closed. Tracking, refunds and
 * cancelling live on each order's own page.
 */
export function OrderHistory() {
  const [page, setPage] = useState(1);
  const orders = useOrders(page);

  return (
    <section aria-labelledby="your-orders" className="flex flex-col gap-3">
      <h2 id="your-orders" className={ACCOUNT_SECTION_TITLE}>
        Your orders
      </h2>
      <QueryState
        query={orders}
        pending={<OrdersSkeleton />}
        errorTitle="We couldn't load your orders"
        isEmpty={(data) => data.total === 0}
        empty={
          <EmptyState
            icon={<PackageIcon className="size-6" strokeWidth={1.25} />}
            title="No orders yet"
            description="Orders you place will appear here."
            className="py-8"
          />
        }
      >
        {(data) => {
          const lastPage = Math.max(1, Math.ceil(data.total / ORDERS_PAGE_SIZE));

          return (
            <>
              <ul
                className={cn(
                  'divide-y divide-border border-y border-border',
                  orders.isPlaceholderData && 'opacity-60',
                )}
              >
                {data.items.map((order) => (
                  <li key={order.id}>
                    <Link
                      href={`/orders/${order.id}`}
                      className="flex items-center justify-between gap-4 py-3 text-sm hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
                    >
                      <span className="min-w-0">
                        <span className="block font-mono text-xs">{order.orderNumber}</span>
                        <span className="block text-xs text-muted-foreground">
                          {formatOrderDate(order.placedAt)} · {ORDER_STATUS_LABEL[order.status]}
                        </span>
                      </span>
                      <span className="shrink-0 tabular-nums">
                        {formatMoney(order.totalMinor, order.currency)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
              {lastPage > 1 ? (
                <nav
                  aria-label="Order pages"
                  className="flex items-center justify-between text-xs text-muted-foreground"
                >
                  <button
                    type="button"
                    disabled={page <= 1}
                    onClick={() => {
                      setPage(page - 1);
                    }}
                    className="underline-offset-4 hover:underline disabled:opacity-40"
                  >
                    Newer
                  </button>
                  <span className="tabular-nums">
                    Page {page} of {lastPage}
                  </span>
                  <button
                    type="button"
                    disabled={page >= lastPage}
                    onClick={() => {
                      setPage(page + 1);
                    }}
                    className="underline-offset-4 hover:underline disabled:opacity-40"
                  >
                    Older
                  </button>
                </nav>
              ) : null}
            </>
          );
        }}
      </QueryState>
    </section>
  );
}
