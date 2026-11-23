'use client';

import { HistoryIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ADMIN_PAGE_SIZE, useInventoryMovements } from '@/lib/admin/api';
import { MOVEMENT_REASON_LABEL, type MovementReason } from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  FilterBar,
  FilterSelect,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
  toOptions,
} from '../admin-ui';

const REASONS = Object.keys(MOVEMENT_REASON_LABEL) as MovementReason[];

/** The stock ledger: every change, newest first, with who or what made it. */
export function MovementsList() {
  const params = useListParams();
  const variantId = params.get('variantId');
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    variantId,
    reason: params.getOneOf('reason', REASONS),
  };
  const movements = useInventoryMovements(filters);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Stock history"
        description="Every change to stock, and why. Nothing here can be edited."
        {...(variantId ? { back: { href: '/admin/inventory', label: 'Inventory' } } : {})}
      />

      <FilterBar>
        <FilterSelect
          label="Reason"
          value={filters.reason}
          onChange={(reason) => {
            params.set({ reason });
          }}
          options={toOptions(MOVEMENT_REASON_LABEL)}
        />
        {variantId ? (
          <Link
            href={params.hrefWith({ variantId: undefined })}
            className={`pb-2 text-xs text-muted-foreground underline underline-offset-4 ${focusRing}`}
          >
            Showing one variant · show all
          </Link>
        ) : null}
      </FilterBar>

      <AdminQueryState
        query={movements}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load stock history"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<HistoryIcon className="size-6" strokeWidth={1.25} />}
            title="No stock changes match"
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Stock history" stale={movements.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    When
                  </th>
                  <th scope="col" className={TH}>
                    Product
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Change
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    After
                  </th>
                  <th scope="col" className={TH}>
                    Reason
                  </th>
                  <th scope="col" className={TH}>
                    By
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((movement) => (
                  <tr key={movement.id} className={TBODY_ROW}>
                    <td className={`${TD} whitespace-nowrap text-muted-foreground`}>
                      {formatAdminDateTime(movement.createdAt)}
                    </td>
                    <td className={TD}>
                      <span className="block">{movement.variant.product.name}</span>
                      <span className="block font-mono text-xs text-muted-foreground">
                        {movement.variant.sku}
                      </span>
                    </td>
                    <td
                      className={`${TD} text-right tabular-nums ${movement.delta < 0 ? 'text-destructive' : 'text-success'}`}
                    >
                      {movement.delta > 0 ? `+${String(movement.delta)}` : movement.delta}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {movement.resultingQuantity}
                    </td>
                    <td className={TD}>
                      {MOVEMENT_REASON_LABEL[movement.reason]}
                      {movement.note ? (
                        <span className="block text-xs text-muted-foreground">{movement.note}</span>
                      ) : null}
                    </td>
                    <td className={`${TD} text-muted-foreground`}>
                      {movement.actor ? (
                        movement.actor.email
                      ) : movement.orderId ? (
                        <Link
                          href={`/admin/orders/${movement.orderId}`}
                          className={`underline-offset-4 hover:underline ${focusRing}`}
                        >
                          An order
                        </Link>
                      ) : (
                        'System'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="changes"
            />
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
