'use client';

import { zodResolver } from '@hookform/resolvers/zod';
import { MapPinIcon } from 'lucide-react';
import { useState } from 'react';
import { type Path, useForm } from 'react-hook-form';
import { toast } from 'sonner';
import { z } from 'zod';

import { EmptyState } from '@/components/common/empty-state';
import { QueryState } from '@/components/common/query-state';
import { TextField } from '@/components/common/text-field';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useAsyncAction } from '@/hooks/use-async-action';
import { type AddressInput, useAddressMutations } from '@/lib/account/use-account';
import { errorMessage, isApiError } from '@/lib/api-error';
import type { SavedAddress } from '@/lib/checkout/types';
import { useSavedAddresses } from '@/lib/checkout/use-checkout';
import { cn } from '@/lib/utils';

import {
  AccountSection,
  applyServerFieldErrors,
  FormAlert,
  PRIMARY_BUTTON,
  SECONDARY_BUTTON,
  TEXT_BUTTON,
} from './account-form';

/** The only country the API delivers to for now (ADR 0018), as in the checkout form. */
const COUNTRY_CODE = 'BD';
const COUNTRY_NAME = 'Bangladesh';

/** UX only: the API validates every field again, and its verdict lands on the same fields. */
const addressSchema = z.object({
  label: z.string().trim().max(60, 'Keep the label under 60 characters'),
  recipientName: z.string().trim().min(1, 'Enter the recipient’s name').max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\+?[0-9][0-9\s()-]{6,30}$/, 'Enter a valid phone number'),
  line1: z.string().trim().min(1, 'Enter the address').max(200),
  line2: z.string().trim().max(200),
  city: z.string().trim().min(1, 'Enter the city').max(120),
  state: z.string().trim().max(120),
  postalCode: z.string().trim().min(1, 'Enter the postal code').max(32),
  isDefault: z.boolean(),
});

type AddressValues = z.infer<typeof addressSchema>;

const FIELDS: readonly Path<AddressValues>[] = [
  'label',
  'recipientName',
  'phone',
  'line1',
  'line2',
  'city',
  'state',
  'postalCode',
];

const EMPTY: AddressValues = {
  label: '',
  recipientName: '',
  phone: '',
  line1: '',
  line2: '',
  city: '',
  state: '',
  postalCode: '',
  isDefault: false,
};

function toFormValues(address: SavedAddress): AddressValues {
  return {
    label: address.label ?? '',
    recipientName: address.recipientName,
    phone: address.phone ?? '',
    line1: address.line1,
    line2: address.line2 ?? '',
    city: address.city,
    state: address.state ?? '',
    postalCode: address.postalCode,
    isDefault: address.isDefault,
  };
}

/** Blank optional fields are sent as `null`: the API refuses `""` rather than store it. */
function toInput(values: AddressValues): AddressInput {
  const optional = (value: string) => value.trim() || null;

  return {
    label: optional(values.label),
    recipientName: values.recipientName.trim(),
    phone: optional(values.phone),
    line1: values.line1.trim(),
    line2: optional(values.line2),
    city: values.city.trim(),
    state: optional(values.state),
    postalCode: values.postalCode.trim(),
    countryCode: COUNTRY_CODE,
    isDefault: values.isDefault,
  };
}

type Editing = { mode: 'create' } | { mode: 'edit'; address: SavedAddress } | null;

/**
 * Saved addresses, the same list checkout offers as shortcuts. Every change invalidates that
 * query, so the next checkout starts from what is here.
 */
export function AddressBook() {
  const addresses = useSavedAddresses();
  const [editing, setEditing] = useState<Editing>(null);
  const [deleting, setDeleting] = useState<SavedAddress | null>(null);

  const close = () => {
    setEditing(null);
  };

  return (
    <AccountSection
      id="account-addresses"
      title="Addresses"
      description="Saved addresses appear as shortcuts at checkout."
      action={
        addresses.isSuccess && addresses.data.length > 0 ? (
          <button
            type="button"
            className={SECONDARY_BUTTON}
            onClick={() => {
              setEditing({ mode: 'create' });
            }}
          >
            Add address
          </button>
        ) : null
      }
    >
      <QueryState
        query={addresses}
        pending={<AddressesSkeleton />}
        errorTitle="We couldn't load your addresses"
        empty={
          <EmptyState
            icon={<MapPinIcon className="size-6" strokeWidth={1.25} />}
            title="No saved addresses"
            description="Save an address to check out faster."
            className="border border-dashed border-border py-8"
            action={
              <button
                type="button"
                className={SECONDARY_BUTTON}
                onClick={() => {
                  setEditing({ mode: 'create' });
                }}
              >
                Add address
              </button>
            }
          />
        }
      >
        {(list) => (
          <ul className="flex flex-col gap-3">
            {list.map((address) => (
              <AddressCard
                key={address.id}
                address={address}
                onEdit={() => {
                  setEditing({ mode: 'edit', address });
                }}
                onDelete={() => {
                  setDeleting(address);
                }}
              />
            ))}
          </ul>
        )}
      </QueryState>

      <Dialog
        open={editing !== null}
        onOpenChange={(open) => {
          if (!open) close();
        }}
      >
        <DialogContent>
          {editing ? (
            <AddressForm
              // A fresh form per address, so no field carries over from the last one opened.
              key={editing.mode === 'edit' ? editing.address.id : 'new'}
              editing={editing}
              isFirst={addresses.data?.length === 0}
              onDone={close}
            />
          ) : null}
        </DialogContent>
      </Dialog>

      <DeleteAddressDialog
        address={deleting}
        onClose={() => {
          setDeleting(null);
        }}
      />
    </AccountSection>
  );
}

function AddressesSkeleton() {
  return (
    <div role="status" aria-live="polite" className="flex flex-col gap-3">
      <Skeleton aria-hidden="true" className="h-28 w-full" />
      <Skeleton aria-hidden="true" className="h-28 w-full" />
      <span className="sr-only">Loading your addresses</span>
    </div>
  );
}

function AddressCard({
  address,
  onEdit,
  onDelete,
}: {
  address: SavedAddress;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const { update } = useAddressMutations();
  const makeDefault = useAsyncAction(
    () => update.mutateAsync({ id: address.id, input: { isDefault: true } }),
    { successMessage: 'Default address updated.' },
  );

  const title = address.label ?? address.recipientName;

  return (
    <li className="flex flex-col gap-3 border border-border p-4 text-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-medium">{title}</p>
          {address.label ? <p>{address.recipientName}</p> : null}
        </div>
        {address.isDefault ? (
          <span className="shrink-0 border border-foreground px-2 py-0.5 text-[10px] font-semibold tracking-[0.16em] uppercase">
            Default
          </span>
        ) : null}
      </div>

      <address className="text-muted-foreground not-italic">
        {address.line1}
        {address.line2 ? <>, {address.line2}</> : null}
        <br />
        {[address.city, address.state, address.postalCode].filter(Boolean).join(', ')}
        {address.phone ? (
          <>
            <br />
            {address.phone}
          </>
        ) : null}
      </address>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <button type="button" className={TEXT_BUTTON} onClick={onEdit} aria-label={`Edit ${title}`}>
          Edit
        </button>
        {!address.isDefault ? (
          <button
            type="button"
            className={TEXT_BUTTON}
            disabled={makeDefault.isPending}
            onClick={() => void makeDefault.run()}
            aria-label={`Make ${title} the default address`}
          >
            {makeDefault.isPending ? 'Updating…' : 'Make default'}
          </button>
        ) : null}
        <button
          type="button"
          className={cn(TEXT_BUTTON, 'text-destructive')}
          onClick={onDelete}
          aria-label={`Delete ${title}`}
        >
          Delete
        </button>
      </div>
    </li>
  );
}

function AddressForm({
  editing,
  isFirst,
  onDone,
}: {
  editing: Exclude<Editing, null>;
  isFirst: boolean;
  onDone: () => void;
}) {
  const { create, update } = useAddressMutations();
  const isEdit = editing.mode === 'edit';

  const {
    register,
    handleSubmit,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<AddressValues>({
    resolver: zodResolver(addressSchema),
    // The first address saved becomes the default unless the customer unticks it.
    defaultValues: isEdit ? toFormValues(editing.address) : { ...EMPTY, isDefault: isFirst },
  });

  const save = useAsyncAction(
    (values: AddressValues) =>
      isEdit
        ? update.mutateAsync({ id: editing.address.id, input: toInput(values) })
        : create.mutateAsync(toInput(values)),
    {
      toastOnError: false,
      onSuccess: () => {
        toast.success(isEdit ? 'Address updated.' : 'Address saved.');
        onDone();
      },
      onError: (error) => {
        applyServerFieldErrors(error, FIELDS, setError, setFocus);
      },
    },
  );

  const failure = save.error;
  const placedOnField =
    isApiError(failure) &&
    failure.details.some((detail) => FIELDS.some((field) => field === detail.field));
  const unplaced = failure !== undefined && !placedOnField;

  const onSubmit = handleSubmit(async (values) => {
    await save.run(values);
  });

  const alreadyDefault = isEdit && editing.address.isDefault;

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-4">
      <DialogTitle>{isEdit ? 'Edit address' : 'Add an address'}</DialogTitle>
      <DialogDescription>We deliver within {COUNTRY_NAME} only for now.</DialogDescription>

      <div className="grid gap-4 sm:grid-cols-2">
        <TextField
          className="sm:col-span-2"
          label="Label (optional)"
          registration={register('label')}
          error={errors.label?.message}
          hint="For example “Home” or “Office”."
        />
        <TextField
          label="Full name"
          autoComplete="name"
          registration={register('recipientName')}
          error={errors.recipientName?.message}
        />
        <TextField
          label="Phone"
          type="tel"
          autoComplete="tel"
          registration={register('phone')}
          error={errors.phone?.message}
        />
        <TextField
          className="sm:col-span-2"
          label="Address"
          autoComplete="address-line1"
          registration={register('line1')}
          error={errors.line1?.message}
        />
        <TextField
          className="sm:col-span-2"
          label="Apartment, floor, landmark (optional)"
          autoComplete="address-line2"
          registration={register('line2')}
          error={errors.line2?.message}
        />
        <TextField
          label="City"
          autoComplete="address-level2"
          registration={register('city')}
          error={errors.city?.message}
        />
        <TextField
          label="Division (optional)"
          autoComplete="address-level1"
          registration={register('state')}
          error={errors.state?.message}
        />
        <TextField
          label="Postal code"
          autoComplete="postal-code"
          registration={register('postalCode')}
          error={errors.postalCode?.message}
        />
        <div className="flex flex-col gap-1.5 text-sm">
          <span className="text-xs text-muted-foreground">Country</span>
          <span className="flex h-11 items-center">{COUNTRY_NAME}</span>
        </div>
      </div>

      {alreadyDefault ? (
        <p className="text-sm text-muted-foreground">
          This is your default address. Make another one the default to change it.
        </p>
      ) : (
        <label className="flex items-center gap-2.5 text-sm">
          <input type="checkbox" {...register('isDefault')} className="size-4 accent-foreground" />
          Use as my default address
        </label>
      )}

      <FormAlert message={unplaced ? errorMessage(failure) : undefined} />

      <div className="flex flex-wrap gap-3">
        <button type="submit" disabled={save.isPending} className={PRIMARY_BUTTON}>
          {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Save address'}
        </button>
        <button type="button" onClick={onDone} className={SECONDARY_BUTTON}>
          Cancel
        </button>
      </div>
    </form>
  );
}

function DeleteAddressDialog({
  address,
  onClose,
}: {
  address: SavedAddress | null;
  onClose: () => void;
}) {
  const { remove } = useAddressMutations();
  const action = useAsyncAction((id: string) => remove.mutateAsync(id), {
    toastOnError: false,
    successMessage: 'Address deleted.',
    onSuccess: onClose,
  });

  return (
    <Dialog
      open={address !== null}
      onOpenChange={(open) => {
        if (!open) {
          action.reset();
          onClose();
        }
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>Delete this address?</DialogTitle>
        <DialogDescription>
          {address
            ? `${address.label ?? address.recipientName}, ${address.line1}, ${address.city}. `
            : null}
          Orders already placed keep their delivery address.
        </DialogDescription>

        <FormAlert message={action.error ? errorMessage(action.error) : undefined} />

        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            disabled={action.isPending || !address}
            onClick={() => {
              if (address) void action.run(address.id);
            }}
            className={cn(PRIMARY_BUTTON, 'bg-destructive text-white')}
          >
            {action.isPending ? 'Deleting…' : 'Delete address'}
          </button>
          <button type="button" onClick={onClose} className={SECONDARY_BUTTON}>
            Keep it
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
