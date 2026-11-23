'use client';

import { XIcon } from 'lucide-react';
import { useState } from 'react';

import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { NativeSelect } from '@/components/ui/native-select';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  type CouponWrite,
  useAdminProducts,
  useCreateCoupon,
  useUpdateCoupon,
} from '@/lib/admin/api';
import { isMajorAmount, majorToMinor, minorToMajor } from '@/lib/admin/price';
import type { AdminCoupon, CouponType } from '@/lib/admin/types';

import { FormActions, FormError, FormField } from '../admin-ui';

interface Draft {
  code: string;
  type: CouponType;
  percent: string;
  amount: string;
  minimumSpend: string;
  maxDiscount: string;
  startsAt: string;
  endsAt: string;
  usageLimit: string;
  perUserLimit: string;
  isActive: boolean;
  appliesToAllProducts: boolean;
  products: { id: string; name: string }[];
}

type Errors = Partial<Record<keyof Draft, string>>;

/** `datetime-local` speaks the viewer's local time; the API takes an ISO instant. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const date = new Date(iso);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function fromLocalInput(value: string): string | null {
  return value ? new Date(value).toISOString() : null;
}

function toDraft(coupon: AdminCoupon | null): Draft {
  return {
    code: coupon?.code ?? '',
    type: coupon?.type ?? 'PERCENT',
    percent: coupon?.percentBps ? String(coupon.percentBps / 100) : '',
    amount: coupon?.valueMinor ? minorToMajor(coupon.valueMinor) : '',
    minimumSpend: coupon?.minimumSpendMinor ? minorToMajor(coupon.minimumSpendMinor) : '',
    maxDiscount: coupon?.maxDiscountMinor ? minorToMajor(coupon.maxDiscountMinor) : '',
    startsAt: toLocalInput(coupon?.startsAt ?? null),
    endsAt: toLocalInput(coupon?.endsAt ?? null),
    usageLimit: coupon?.usageLimit ? String(coupon.usageLimit) : '',
    perUserLimit: coupon?.perUserLimit ? String(coupon.perUserLimit) : '',
    isActive: coupon?.isActive ?? true,
    appliesToAllProducts: coupon?.appliesToAllProducts ?? true,
    products: coupon?.products.map(({ id, name }) => ({ id, name })) ?? [],
  };
}

const WHOLE = /^\d{1,9}$/;
const PERCENT = /^\d{1,3}(\.\d{1,2})?$/;

/** What the form can check itself. The API checks it all again and has the last word. */
function validate(draft: Draft, creating: boolean): Errors {
  const errors: Errors = {};
  const money = (value: string) => value.trim() === '' || isMajorAmount(value);

  if (creating && !/^[A-Za-z0-9][A-Za-z0-9_-]{2,31}$/.test(draft.code.trim())) {
    errors.code = 'Use 3–32 letters, digits, - or _';
  }
  if (draft.type === 'PERCENT') {
    const value = Number(draft.percent);
    if (!PERCENT.test(draft.percent.trim()) || value <= 0 || value > 100) {
      errors.percent = 'Between 0.01 and 100';
    }
  } else if (!isMajorAmount(draft.amount) || majorToMinor(draft.amount) < 1) {
    errors.amount = 'An amount such as 250 or 99.50';
  }
  if (!money(draft.minimumSpend)) errors.minimumSpend = 'An amount, or leave it empty';
  if (!money(draft.maxDiscount)) errors.maxDiscount = 'An amount, or leave it empty';
  for (const key of ['usageLimit', 'perUserLimit'] as const) {
    if (draft[key].trim() && (!WHOLE.test(draft[key].trim()) || Number(draft[key]) < 1)) {
      errors[key] = 'A whole number, or leave it empty';
    }
  }
  if (draft.startsAt && draft.endsAt && draft.endsAt <= draft.startsAt) {
    errors.endsAt = 'Must be after the start';
  }
  if (!draft.appliesToAllProducts && draft.products.length === 0) {
    errors.products = 'Choose at least one product';
  }

  return errors;
}

function toWrite(draft: Draft, creating: boolean): CouponWrite {
  const amountOrNull = (value: string) => (value.trim() ? majorToMinor(value) : null);
  const countOrNull = (value: string) => (value.trim() ? Number(value) : null);

  return {
    ...(creating ? { code: draft.code.trim().toUpperCase(), type: draft.type } : {}),
    ...(draft.type === 'PERCENT'
      ? { percentBps: Math.round(Number(draft.percent) * 100) }
      : { valueMinor: majorToMinor(draft.amount) }),
    minimumSpendMinor: amountOrNull(draft.minimumSpend),
    maxDiscountMinor: amountOrNull(draft.maxDiscount),
    startsAt: fromLocalInput(draft.startsAt),
    endsAt: fromLocalInput(draft.endsAt),
    usageLimit: countOrNull(draft.usageLimit),
    perUserLimit: countOrNull(draft.perUserLimit),
    isActive: draft.isActive,
    appliesToAllProducts: draft.appliesToAllProducts,
    productIds: draft.appliesToAllProducts ? [] : draft.products.map((product) => product.id),
  };
}

/**
 * Create or edit a coupon. The code and its kind are fixed once made: orders keep the code they
 * used, and changing what a code means under people who have it would surprise them. Changes
 * never touch orders already placed.
 */
export function CouponDialog({
  coupon,
  open,
  onClose,
}: {
  /** `null` to create. */
  coupon: AdminCoupon | null;
  open: boolean;
  onClose: () => void;
}) {
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent className="max-h-[90dvh] max-w-xl overflow-y-auto">
        {/* Keyed so each opening starts from what the coupon is now. */}
        {open ? (
          <CouponFormBody key={coupon?.id ?? 'new'} coupon={coupon} onClose={onClose} />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function CouponFormBody({ coupon, onClose }: { coupon: AdminCoupon | null; onClose: () => void }) {
  const creating = coupon === null;
  const [draft, setDraft] = useState(() => toDraft(coupon));
  const [errors, setErrors] = useState<Errors>({});
  const create = useCreateCoupon();
  const update = useUpdateCoupon();
  const action = useAsyncAction(
    (body: CouponWrite) =>
      creating ? create.mutateAsync(body) : update.mutateAsync({ couponId: coupon.id, body }),
    {
      toastOnError: false,
      successMessage: (saved) => (creating ? `${saved.code} created.` : `${saved.code} saved.`),
      // The API's field-by-field reasons are listed by `FormError` under the form.
      onSuccess: onClose,
    },
  );

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  return (
    <form
      noValidate
      className="flex flex-col gap-4"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validate(draft, creating);
        setErrors(found);
        if (Object.keys(found).length === 0) void action.run(toWrite(draft, creating));
      }}
    >
      <DialogTitle>{creating ? 'New coupon' : `Edit ${coupon.code}`}</DialogTitle>
      <DialogDescription>
        One code per order. It takes money off the products only, never delivery or tax.
      </DialogDescription>

      <div className="grid gap-4 sm:grid-cols-2">
        <FormField
          label="Code"
          error={errors.code}
          hint={creating ? 'Customers type this.' : 'Cannot change.'}
        >
          {(control) => (
            <Input
              {...control}
              value={draft.code}
              disabled={!creating}
              maxLength={32}
              className="uppercase"
              onChange={(event) => {
                set('code', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Kind">
          {(control) => (
            <NativeSelect
              {...control}
              value={draft.type}
              disabled={!creating}
              onChange={(event) => {
                set('type', event.target.value as CouponType);
              }}
            >
              <option value="PERCENT">Percentage off</option>
              <option value="FIXED">Amount off</option>
            </NativeSelect>
          )}
        </FormField>

        {draft.type === 'PERCENT' ? (
          <FormField label="Percentage" error={errors.percent} hint="Of the eligible products.">
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={draft.percent}
                onChange={(event) => {
                  set('percent', event.target.value);
                }}
              />
            )}
          </FormField>
        ) : (
          <FormField
            label="Amount (৳)"
            error={errors.amount}
            hint="Never more than the products cost."
          >
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={draft.amount}
                onChange={(event) => {
                  set('amount', event.target.value);
                }}
              />
            )}
          </FormField>
        )}
        <FormField label="Largest discount (৳, optional)" error={errors.maxDiscount}>
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.maxDiscount}
              onChange={(event) => {
                set('maxDiscount', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          label="Minimum spend (৳, optional)"
          error={errors.minimumSpend}
          hint="Compared with the whole subtotal."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.minimumSpend}
              onChange={(event) => {
                set('minimumSpend', event.target.value);
              }}
            />
          )}
        </FormField>
        <div />
        <FormField label="Starts (optional)" error={errors.startsAt}>
          {(control) => (
            <Input
              {...control}
              type="datetime-local"
              value={draft.startsAt}
              onChange={(event) => {
                set('startsAt', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          label="Ends (optional)"
          error={errors.endsAt}
          hint="It stops working at this moment."
        >
          {(control) => (
            <Input
              {...control}
              type="datetime-local"
              value={draft.endsAt}
              onChange={(event) => {
                set('endsAt', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField
          label="Total uses (optional)"
          error={errors.usageLimit}
          hint={coupon ? `Used ${String(coupon.usedCount)} times so far.` : 'Across all customers.'}
        >
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              value={draft.usageLimit}
              onChange={(event) => {
                set('usageLimit', event.target.value);
              }}
            />
          )}
        </FormField>
        <FormField label="Uses per customer (optional)" error={errors.perUserLimit}>
          {(control) => (
            <Input
              {...control}
              inputMode="numeric"
              value={draft.perUserLimit}
              onChange={(event) => {
                set('perUserLimit', event.target.value);
              }}
            />
          )}
        </FormField>
      </div>

      <fieldset className="flex flex-col gap-2 text-sm">
        <legend className="mb-1 text-sm font-medium">Applies to</legend>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="coupon-scope"
            checked={draft.appliesToAllProducts}
            onChange={() => {
              set('appliesToAllProducts', true);
            }}
          />
          Every product
        </label>
        <label className="flex items-center gap-2">
          <input
            type="radio"
            name="coupon-scope"
            checked={!draft.appliesToAllProducts}
            onChange={() => {
              set('appliesToAllProducts', false);
            }}
          />
          Only the products I choose
        </label>
        {draft.appliesToAllProducts ? null : (
          <ProductPicker
            chosen={draft.products}
            error={errors.products}
            onChange={(products) => {
              set('products', products);
            }}
          />
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={draft.isActive}
          onChange={(event) => {
            set('isActive', event.target.checked);
          }}
        />
        Customers can use it (switch off to stop it at once)
      </label>

      <FormError error={action.error} />
      <FormActions
        isPending={action.isPending}
        submitLabel={creating ? 'Create coupon' : 'Save'}
        pendingLabel="Saving…"
        onCancel={onClose}
      />
    </form>
  );
}

function ProductPicker({
  chosen,
  error,
  onChange,
}: {
  chosen: readonly { id: string; name: string }[];
  error: string | undefined;
  onChange: (products: { id: string; name: string }[]) => void;
}) {
  const [query, setQuery] = useState('');
  const search = useAdminProducts({ q: query.trim() || undefined, page: 1, pageSize: 8 });
  const chosenIds = new Set(chosen.map((product) => product.id));

  return (
    <div className="flex flex-col gap-2 rounded-md border border-border p-3">
      {chosen.length > 0 ? (
        <ul className="flex flex-wrap gap-1.5" aria-label="Chosen products">
          {chosen.map((product) => (
            <li
              key={product.id}
              className="inline-flex items-center gap-1 rounded-full bg-muted px-2.5 py-1 text-xs"
            >
              {product.name}
              <button
                type="button"
                aria-label={`Remove ${product.name}`}
                onClick={() => {
                  onChange(chosen.filter((entry) => entry.id !== product.id));
                }}
              >
                <XIcon className="size-3" aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <Input
        type="search"
        aria-label="Find a product"
        placeholder="Find a product by name"
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
        }}
      />
      <ul className="flex max-h-48 flex-col overflow-y-auto text-sm">
        {(search.data?.items ?? [])
          .filter((product) => !chosenIds.has(product.id))
          .map((product) => (
            <li key={product.id}>
              <button
                type="button"
                className="w-full rounded px-2 py-1.5 text-left hover:bg-muted"
                onClick={() => {
                  onChange([...chosen, { id: product.id, name: product.name }]);
                }}
              >
                {product.name}
                <span className="ml-2 text-xs text-muted-foreground">
                  {product.status.toLowerCase()}
                </span>
              </button>
            </li>
          ))}
      </ul>
      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
