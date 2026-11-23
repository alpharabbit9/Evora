'use client';

import { BoxesIcon } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';

import { EmptyState } from '@/components/common/empty-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  ADMIN_PAGE_SIZE,
  categoryLabel,
  useAdjustStock,
  useAdminInventory,
  useCategoryOptions,
} from '@/lib/admin/api';
import {
  ADJUSTMENT_REASON_LABEL,
  type AdjustmentReason,
  type InventoryRow,
} from '@/lib/admin/types';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  FilterBar,
  FilterSelect,
  FormActions,
  FormError,
  FormField,
  SearchField,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatOptions,
  toOptions,
} from '../admin-ui';

/**
 * Stock per variant. Every change goes through an adjustment with a reason, so the movement
 * ledger explains every number here (ADR 0004).
 */
export function InventoryList() {
  const params = useListParams();
  const categories = useCategoryOptions();
  const lowOnly = params.getOneOf('lowStockOnly', ['true'] as const);
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    q: params.get('q'),
    lowStockOnly: lowOnly ?? 'false',
    categoryId: params.get('categoryId'),
  };
  const inventory = useAdminInventory(filters);
  const [adjusting, setAdjusting] = useState<InventoryRow | null>(null);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Inventory"
        description="Orders take stock as they are placed; cancellations put it back. Adjust here for anything else."
      />

      <FilterBar>
        <SearchField
          label="Search"
          placeholder="SKU or product name"
          value={filters.q}
          onSearch={(q) => {
            params.set({ q });
          }}
        />
        <FilterSelect
          label="Stock"
          value={lowOnly}
          onChange={(lowStockOnly) => {
            params.set({ lowStockOnly });
          }}
          options={[{ value: 'true', label: 'Low stock only' }]}
        />
        <FilterSelect
          label="Category"
          value={filters.categoryId}
          disabled={!categories.data}
          onChange={(categoryId) => {
            params.set({ categoryId });
          }}
          options={(categories.data ?? []).map((category) => ({
            value: category.id,
            label: categoryLabel(category),
          }))}
        />
      </FilterBar>

      <AdminQueryState
        query={inventory}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load inventory"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<BoxesIcon className="size-6" strokeWidth={1.25} />}
            title={lowOnly ? 'Nothing is running low' : 'No variants match'}
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Inventory" stale={inventory.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Product
                  </th>
                  <th scope="col" className={TH}>
                    SKU
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    In stock
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Alert at
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((row) => (
                  <tr key={row.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <Link
                        href={`/admin/products/${row.product.id}`}
                        className={`underline-offset-4 hover:underline ${focusRing}`}
                      >
                        {row.product.name}
                      </Link>
                      <span className="block text-xs text-muted-foreground">
                        {formatOptions(row.options)}
                      </span>
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{row.sku}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      <span className="inline-flex items-center gap-2">
                        {row.isLowStock ? <Badge tone="warning">Low</Badge> : null}
                        {row.stockQuantity}
                      </span>
                    </td>
                    <td className={`${TD} text-right text-muted-foreground tabular-nums`}>
                      {row.lowStockThreshold || '—'}
                    </td>
                    <td className={`${TD} text-right whitespace-nowrap`}>
                      <Link
                        href={`/admin/inventory/movements?variantId=${row.id}`}
                        className={`mr-2 text-xs text-muted-foreground underline-offset-4 hover:underline ${focusRing}`}
                      >
                        History
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setAdjusting(row);
                        }}
                      >
                        Adjust<span className="sr-only"> {row.sku}</span>
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
              noun="variants"
            />
          </div>
        )}
      </AdminQueryState>

      {adjusting ? (
        <AdjustDialog
          row={adjusting}
          onClose={() => {
            setAdjusting(null);
          }}
        />
      ) : null}
    </div>
  );
}

function AdjustDialog({ row, onClose }: { row: InventoryRow; onClose: () => void }) {
  const adjust = useAdjustStock();
  const action = useAsyncAction(adjust.mutateAsync, {
    toastOnError: false,
    successMessage: (result) => `${result.sku} now has ${String(result.stockQuantity)} in stock.`,
    onSuccess: onClose,
  });
  const [direction, setDirection] = useState<'add' | 'remove'>('add');
  const [quantity, setQuantity] = useState('');
  const [reason, setReason] = useState<AdjustmentReason>('ADMIN_ADJUSTMENT');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | undefined>();

  const amount = Number(quantity);
  const valid = /^\d{1,6}$/.test(quantity.trim()) && amount > 0;
  const result = valid ? row.stockQuantity + (direction === 'add' ? amount : -amount) : null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>Adjust {row.sku}</DialogTitle>
        <DialogDescription>
          {row.product.name}: {row.stockQuantity} in stock now. The change is recorded with your
          name and reason.
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();

            if (!valid) {
              setError('Enter a whole number above zero');
              return;
            }

            if (result !== null && result < 0) {
              setError(`Only ${String(row.stockQuantity)} can be removed`);
              return;
            }

            setError(undefined);
            void action.run({
              variantId: row.id,
              delta: direction === 'add' ? amount : -amount,
              reason,
              ...(note.trim() ? { note: note.trim() } : {}),
            });
          }}
        >
          <div className="grid grid-cols-2 gap-4">
            <FormField label="Change">
              {(control) => (
                <NativeSelect
                  {...control}
                  value={direction}
                  onChange={(event) => {
                    setDirection(event.target.value as 'add' | 'remove');
                  }}
                >
                  <option value="add">Add stock</option>
                  <option value="remove">Remove stock</option>
                </NativeSelect>
              )}
            </FormField>
            <FormField
              label="Quantity"
              error={error}
              hint={
                result !== null && result >= 0 ? `Leaves ${String(result)} in stock` : undefined
              }
            >
              {(control) => (
                <Input
                  {...control}
                  required
                  inputMode="numeric"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                  }}
                />
              )}
            </FormField>
          </div>
          <FormField label="Reason">
            {(control) => (
              <NativeSelect
                {...control}
                value={reason}
                onChange={(event) => {
                  setReason(event.target.value as AdjustmentReason);
                }}
              >
                {toOptions(ADJUSTMENT_REASON_LABEL).map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </NativeSelect>
            )}
          </FormField>
          <FormField label="Note (optional)">
            {(control) => (
              <Textarea
                {...control}
                maxLength={500}
                value={note}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel="Save adjustment"
            pendingLabel="Saving…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
