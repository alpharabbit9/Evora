'use client';

import { BarChart3Icon } from 'lucide-react';
import Link from 'next/link';
import { useId } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useAdminOverview } from '@/lib/admin/api';
import type { AdminOverview } from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';
import { formatMoney } from '@/lib/money';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminQueryState,
  Badge,
  FilterBar,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
} from '../admin-ui';
import { ORDER_STATUS_ADMIN } from '../orders/order-labels';

const DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * What sold in a date range (ADR 0022). A sale is an order that is confirmed or further along;
 * awaiting payment, cancelled and failed orders are not, and refunds are subtracted on the day they
 * were made. The definitions are the API's (`analytics.service.ts`), stated again under the tiles
 * so nobody has to guess what a number includes.
 */
export function Overview() {
  const params = useListParams();
  const from = params.get('from');
  const to = params.get('to');
  const range = {
    ...(from && DATE.test(from) ? { from } : {}),
    ...(to && DATE.test(to) ? { to } : {}),
  };
  const overview = useAdminOverview(range);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Overview"
        description="Sales by the day orders were placed, in store time (UTC+6). The last 30 days unless you choose a range."
      />

      <FilterBar>
        <DateField
          label="From"
          value={range.from ?? overview.data?.range.from ?? ''}
          onChange={(value) => {
            params.set({ from: value || undefined });
          }}
        />
        <DateField
          label="To"
          value={range.to ?? overview.data?.range.to ?? ''}
          onChange={(value) => {
            params.set({ to: value || undefined });
          }}
        />
      </FilterBar>

      <AdminQueryState
        query={overview}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load the overview"
        isEmpty={() => false}
      >
        {(data) => <OverviewBody data={data} stale={overview.isPlaceholderData} />}
      </AdminQueryState>
    </div>
  );
}

function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
}) {
  const id = useId();
  return (
    <div className="flex w-full flex-col gap-1.5 sm:w-44">
      <Label htmlFor={id} className="text-xs text-muted-foreground">
        {label}
      </Label>
      <Input
        id={id}
        type="date"
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
        }}
      />
    </div>
  );
}

function OverviewBody({ data, stale }: { data: AdminOverview; stale: boolean }) {
  const money = (minor: number) => formatMoney(minor, data.currency);
  const peak = Math.max(1, ...data.daily.map((day) => day.salesMinor));

  const tiles = [
    { label: 'Sales', value: money(data.salesMinor), hint: `${String(data.ordersCounted)} orders` },
    { label: 'Refunds', value: money(data.refundsMinor), hint: 'Made in this range' },
    { label: 'Net', value: money(data.netMinor), hint: 'Sales minus refunds' },
    {
      label: 'Average order',
      value: data.averageOrderMinor === null ? '—' : money(data.averageOrderMinor),
      hint: `Discounts given ${money(data.discountsMinor)}`,
    },
  ];

  return (
    <div
      className={stale ? 'flex flex-col gap-6 opacity-60' : 'flex flex-col gap-6'}
      aria-busy={stale}
    >
      <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-lg border border-border bg-card px-4 py-3">
            <dt className="text-xs text-muted-foreground">{tile.label}</dt>
            <dd className="mt-1 text-2xl font-medium tabular-nums">{tile.value}</dd>
            <dd className="text-xs text-muted-foreground">{tile.hint}</dd>
          </div>
        ))}
      </dl>

      <p className="text-sm text-muted-foreground">
        {data.ordersPlaced.toLocaleString('en-US')} orders placed in all, of which{' '}
        {data.ordersCounted.toLocaleString('en-US')} are sales.{' '}
        {data.lowStockVariants > 0 ? (
          <Link
            href="/admin/inventory?lowStockOnly=true"
            className={`underline underline-offset-4 hover:text-foreground ${focusRing}`}
          >
            {data.lowStockVariants.toLocaleString('en-US')} variants are low on stock.
          </Link>
        ) : (
          'No variant is low on stock.'
        )}
      </p>

      <section aria-labelledby="overview-daily" className="flex flex-col gap-3">
        <h2 id="overview-daily" className="text-sm font-medium">
          Sales per day
        </h2>
        {/* A table under the bars is the accessible version; the bars are decoration. */}
        <div
          aria-hidden="true"
          className="flex h-32 items-end gap-px rounded-lg border border-border bg-card p-3"
        >
          {data.daily.map((day) => (
            <div
              key={day.date}
              title={`${day.date}: ${money(day.salesMinor)}`}
              className="min-w-px flex-1 rounded-t-sm bg-foreground/70"
              style={{
                height: `${String(Math.max(day.salesMinor > 0 ? 3 : 0, (day.salesMinor / peak) * 100))}%`,
              }}
            />
          ))}
        </div>
        <details className="text-sm">
          <summary className={`cursor-pointer text-muted-foreground ${focusRing}`}>
            Show as a table
          </summary>
          <TableFrame label="Sales per day">
            <thead>
              <tr className={THEAD_ROW}>
                <th scope="col" className={TH}>
                  Day
                </th>
                <th scope="col" className={TH}>
                  Orders
                </th>
                <th scope="col" className={TH}>
                  Sales
                </th>
              </tr>
            </thead>
            <tbody>
              {data.daily.map((day) => (
                <tr key={day.date} className={TBODY_ROW}>
                  <td className={TD}>{day.date}</td>
                  <td className={`${TD} tabular-nums`}>{day.orders}</td>
                  <td className={`${TD} tabular-nums`}>{money(day.salesMinor)}</td>
                </tr>
              ))}
            </tbody>
          </TableFrame>
        </details>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section aria-labelledby="overview-top" className="flex flex-col gap-3">
          <h2 id="overview-top" className="text-sm font-medium">
            Best sellers
          </h2>
          {data.topProducts.length === 0 ? (
            <EmptyState
              icon={<BarChart3Icon className="size-6" strokeWidth={1.25} />}
              title="No sales in this range"
            />
          ) : (
            <TableFrame label="Best sellers">
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Product
                  </th>
                  <th scope="col" className={TH}>
                    Units
                  </th>
                  <th scope="col" className={TH}>
                    Sales
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.topProducts.map((product) => (
                  <tr key={`${product.productId ?? ''}${product.name}`} className={TBODY_ROW}>
                    <td className={TD}>
                      {product.productId ? (
                        <Link
                          href={`/admin/products/${encodeURIComponent(product.productId)}`}
                          className={`underline underline-offset-4 ${focusRing}`}
                        >
                          {product.name}
                        </Link>
                      ) : (
                        product.name
                      )}
                    </td>
                    <td className={`${TD} tabular-nums`}>{product.units}</td>
                    <td className={`${TD} tabular-nums`}>{money(product.salesMinor)}</td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </section>

        <section aria-labelledby="overview-recent" className="flex flex-col gap-3">
          <h2 id="overview-recent" className="text-sm font-medium">
            Latest orders
          </h2>
          {data.recentOrders.length === 0 ? (
            <EmptyState
              icon={<BarChart3Icon className="size-6" strokeWidth={1.25} />}
              title="No orders in this range"
            />
          ) : (
            <TableFrame label="Latest orders">
              <tbody>
                {data.recentOrders.map((order) => (
                  <tr key={order.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <Link
                        href={`/admin/orders/${encodeURIComponent(order.id)}`}
                        className={`underline underline-offset-4 ${focusRing}`}
                      >
                        {order.orderNumber}
                      </Link>
                    </td>
                    <td className={TD}>
                      <Badge tone={ORDER_STATUS_ADMIN[order.status].tone}>
                        {ORDER_STATUS_ADMIN[order.status].label}
                      </Badge>
                    </td>
                    <td className={`${TD} tabular-nums`}>{money(order.totalMinor)}</td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDateTime(order.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
          )}
        </section>
      </div>
    </div>
  );
}
