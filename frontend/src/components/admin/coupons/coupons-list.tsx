'use client';

import { TicketPercentIcon } from 'lucide-react';
import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { ADMIN_PAGE_SIZE, useAdminCoupons } from '@/lib/admin/api';
import { COUPON_STATE_LABEL, type AdminCoupon, type CouponState } from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';
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
  formatAdminDateTime,
  toOptions,
} from '../admin-ui';
import { CouponDialog } from './coupon-form';

const STATES = Object.keys(COUPON_STATE_LABEL) as CouponState[];

const STATE_TONE: Record<CouponState, 'neutral' | 'success' | 'warning' | 'destructive'> = {
  active: 'success',
  scheduled: 'neutral',
  expired: 'neutral',
  inactive: 'warning',
  used_up: 'neutral',
};

function describeValue(coupon: AdminCoupon): string {
  const value =
    coupon.type === 'PERCENT'
      ? `${String((coupon.percentBps ?? 0) / 100)}% off`
      : `${formatMoney(coupon.valueMinor ?? 0, coupon.currency ?? 'BDT')} off`;
  const extras = [
    coupon.maxDiscountMinor ? `up to ${formatMoney(coupon.maxDiscountMinor, 'BDT')}` : null,
    coupon.minimumSpendMinor ? `over ${formatMoney(coupon.minimumSpendMinor, 'BDT')}` : null,
    coupon.appliesToAllProducts ? null : `${String(coupon.products.length)} products`,
  ].filter(Boolean);

  return extras.length > 0 ? `${value}, ${extras.join(', ')}` : value;
}

/**
 * Coupon codes (ADR 0022). Rules are provisional until PRD §9 decides coupon policy: one per order,
 * products only, and a cancelled or unpaid order gives its use back. Every change is audited.
 */
export function CouponsList() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    state: params.getOneOf('state', STATES),
  };
  const coupons = useAdminCoupons(filters);
  const [editing, setEditing] = useState<AdminCoupon | null | undefined>(undefined);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Coupons"
        description="One code per order, taken off the products only. A cancelled order, or one whose payment failed, gives its use back."
        action={
          <Button
            type="button"
            onClick={() => {
              setEditing(null);
            }}
          >
            New coupon
          </Button>
        }
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="Code"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="State"
          value={filters.state}
          onChange={(state) => {
            params.set({ state });
          }}
          options={toOptions(COUPON_STATE_LABEL)}
        />
      </FilterBar>

      <AdminQueryState
        query={coupons}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load coupons"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<TicketPercentIcon className="size-6" strokeWidth={1.25} />}
            title={filters.q || filters.state ? 'No coupons match' : 'No coupons yet'}
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Coupons" stale={coupons.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Code
                  </th>
                  <th scope="col" className={TH}>
                    Discount
                  </th>
                  <th scope="col" className={TH}>
                    State
                  </th>
                  <th scope="col" className={TH}>
                    Used
                  </th>
                  <th scope="col" className={TH}>
                    Ends
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((coupon) => (
                  <tr key={coupon.id} className={TBODY_ROW}>
                    <td className={`${TD} font-mono text-xs`}>{coupon.code}</td>
                    <td className={TD}>{describeValue(coupon)}</td>
                    <td className={TD}>
                      <Badge tone={STATE_TONE[coupon.state]}>
                        {COUPON_STATE_LABEL[coupon.state]}
                      </Badge>
                    </td>
                    <td className={`${TD} whitespace-nowrap tabular-nums`}>
                      {coupon.usageLimit === null
                        ? String(coupon.usedCount)
                        : `${String(coupon.usedCount)} / ${String(coupon.usageLimit)}`}
                    </td>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {coupon.endsAt ? formatAdminDateTime(coupon.endsAt) : 'Never'}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditing(coupon);
                        }}
                      >
                        Edit<span className="sr-only"> {coupon.code}</span>
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="coupons"
            />
          </div>
        )}
      </AdminQueryState>

      <CouponDialog
        coupon={editing ?? null}
        open={editing !== undefined}
        onClose={() => {
          setEditing(undefined);
        }}
      />
    </div>
  );
}
