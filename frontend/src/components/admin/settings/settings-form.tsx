'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useAsyncAction } from '@/hooks/use-async-action';
import { type SettingsWrite, useSaveSettings, useStoreSettings } from '@/lib/admin/api';
import { isMajorAmount, majorToMinor, minorToMajor } from '@/lib/admin/price';
import type { StoreSettings } from '@/lib/admin/types';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminQueryState,
  FormError,
  FormField,
  formatAdminDateTime,
} from '../admin-ui';

const FEES = [
  ['standardFeeDhakaMinor', 'Standard, Dhaka'],
  ['standardFeeNationalMinor', 'Standard, elsewhere'],
  ['expressFeeDhakaMinor', 'Express, Dhaka'],
  ['expressFeeNationalMinor', 'Express, elsewhere'],
] as const;

type FeeKey = (typeof FEES)[number][0];

interface Draft {
  storeName: string;
  supportEmail: string;
  fees: Record<FeeKey, string>;
  expressEnabled: boolean;
  freeShippingThreshold: string;
  taxPercent: string;
}

function toDraft(settings: StoreSettings): Draft {
  return {
    storeName: settings.storeName,
    supportEmail: settings.supportEmail ?? '',
    fees: {
      standardFeeDhakaMinor: minorToMajor(settings.standardFeeDhakaMinor),
      standardFeeNationalMinor: minorToMajor(settings.standardFeeNationalMinor),
      expressFeeDhakaMinor: minorToMajor(settings.expressFeeDhakaMinor),
      expressFeeNationalMinor: minorToMajor(settings.expressFeeNationalMinor),
    },
    expressEnabled: settings.expressEnabled,
    freeShippingThreshold:
      settings.freeShippingThresholdMinor === null
        ? ''
        : minorToMajor(settings.freeShippingThresholdMinor),
    taxPercent: String(settings.taxRateBps / 100),
  };
}

type Errors = Partial<
  Record<FeeKey | 'storeName' | 'supportEmail' | 'freeShippingThreshold' | 'taxPercent', string>
>;

function validate(draft: Draft): Errors {
  const errors: Errors = {};
  if (!draft.storeName.trim()) errors.storeName = 'Required';
  if (draft.supportEmail.trim() && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(draft.supportEmail.trim())) {
    errors.supportEmail = 'An email address, or leave it empty';
  }
  for (const [key] of FEES) {
    if (!isMajorAmount(draft.fees[key])) errors[key] = 'An amount such as 80 or 150.50';
  }
  if (
    draft.freeShippingThreshold.trim() &&
    (!isMajorAmount(draft.freeShippingThreshold) || majorToMinor(draft.freeShippingThreshold) < 1)
  ) {
    errors.freeShippingThreshold = 'An amount, or leave it empty';
  }
  const tax = Number(draft.taxPercent);
  if (!/^\d{1,2}(\.\d{1,2})?$/.test(draft.taxPercent.trim()) || tax > 50) {
    errors.taxPercent = 'Between 0 and 50';
  }
  return errors;
}

function toWrite(draft: Draft, version: number): SettingsWrite {
  return {
    version,
    storeName: draft.storeName.trim(),
    supportEmail: draft.supportEmail.trim() || null,
    standardFeeDhakaMinor: majorToMinor(draft.fees.standardFeeDhakaMinor),
    standardFeeNationalMinor: majorToMinor(draft.fees.standardFeeNationalMinor),
    expressEnabled: draft.expressEnabled,
    expressFeeDhakaMinor: majorToMinor(draft.fees.expressFeeDhakaMinor),
    expressFeeNationalMinor: majorToMinor(draft.fees.expressFeeNationalMinor),
    freeShippingThresholdMinor: draft.freeShippingThreshold.trim()
      ? majorToMinor(draft.freeShippingThreshold)
      : null,
    taxRateBps: Math.round(Number(draft.taxPercent) * 100),
  };
}

/**
 * Delivery fees, tax and the store's name (ADR 0022). A change prices every checkout from the
 * moment it is saved; a customer already on the checkout page sees the new total before they can
 * pay it. Saving over someone else's newer save is refused, so nobody undoes a change unknowingly.
 */
export function SettingsPage() {
  const settings = useStoreSettings();

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Settings"
        description="These are not a store policy yet (PRD §9): until someone saves them, the development defaults apply."
      />
      <AdminQueryState
        query={settings}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load the settings"
      >
        {/* Keyed by version: after a save, or someone else's, the form restarts from what is stored. */}
        {(data) => <SettingsForm key={data.version} settings={data} />}
      </AdminQueryState>
    </div>
  );
}

function SettingsForm({ settings }: { settings: StoreSettings }) {
  const [draft, setDraft] = useState(() => toDraft(settings));
  const [errors, setErrors] = useState<Errors>({});
  const save = useSaveSettings();
  // Errors are toasted as well as shown: a refused save over a newer version reloads the form
  // (it is keyed by version), and the toast is what still says why.
  const action = useAsyncAction(save.mutateAsync, {
    successMessage: () => 'Settings saved. Checkout uses them from now on.',
  });

  const fee = (key: FeeKey, label: string) => (
    <FormField key={key} label={`${label} (৳)`} error={errors[key]}>
      {(control) => (
        <Input
          {...control}
          inputMode="decimal"
          value={draft.fees[key]}
          onChange={(event) => {
            setDraft((current) => ({
              ...current,
              fees: { ...current.fees, [key]: event.target.value },
            }));
          }}
        />
      )}
    </FormField>
  );

  return (
    <form
      noValidate
      className="flex max-w-3xl flex-col gap-8"
      onSubmit={(event) => {
        event.preventDefault();
        const found = validate(draft);
        setErrors(found);
        if (Object.keys(found).length === 0) void action.run(toWrite(draft, settings.version));
      }}
    >
      <p className="text-sm text-muted-foreground">
        {settings.updatedAt
          ? `Last saved ${formatAdminDateTime(settings.updatedAt)}${settings.updatedBy ? ` by ${settings.updatedBy.name}` : ''}.`
          : 'Nothing saved yet: these are the defaults.'}
      </p>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-medium">Store</legend>
        <FormField label="Store name" error={errors.storeName} hint="Shown in emails.">
          {(control) => (
            <Input
              {...control}
              maxLength={80}
              value={draft.storeName}
              onChange={(event) => {
                setDraft((current) => ({ ...current, storeName: event.target.value }));
              }}
            />
          )}
        </FormField>
        <FormField
          label="Support email (optional)"
          error={errors.supportEmail}
          hint="Shown at the foot of every email."
        >
          {(control) => (
            <Input
              {...control}
              type="email"
              value={draft.supportEmail}
              onChange={(event) => {
                setDraft((current) => ({ ...current, supportEmail: event.target.value }));
              }}
            />
          )}
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-medium">Delivery</legend>
        {FEES.slice(0, 2).map(([key, label]) => fee(key, label))}
        <label className="flex items-center gap-2 text-sm sm:col-span-2">
          <input
            type="checkbox"
            checked={draft.expressEnabled}
            onChange={(event) => {
              setDraft((current) => ({ ...current, expressEnabled: event.target.checked }));
            }}
          />
          Offer express delivery
        </label>
        {draft.expressEnabled ? FEES.slice(2).map(([key, label]) => fee(key, label)) : null}
        <FormField
          label="Free delivery from (৳, optional)"
          error={errors.freeShippingThreshold}
          hint="Compared with the subtotal after any discount."
          className="sm:col-span-2"
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.freeShippingThreshold}
              onChange={(event) => {
                setDraft((current) => ({ ...current, freeShippingThreshold: event.target.value }));
              }}
            />
          )}
        </FormField>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-3 text-sm font-medium">Tax</legend>
        <FormField
          label="Tax rate (%)"
          error={errors.taxPercent}
          hint="Added on top of the products after discount, not on delivery. 0 for none."
        >
          {(control) => (
            <Input
              {...control}
              inputMode="decimal"
              value={draft.taxPercent}
              onChange={(event) => {
                setDraft((current) => ({ ...current, taxPercent: event.target.value }));
              }}
            />
          )}
        </FormField>
      </fieldset>

      <FormError error={action.error} />
      <div>
        <Button type="submit" disabled={action.isPending}>
          {action.isPending ? 'Saving…' : 'Save settings'}
        </Button>
      </div>
    </form>
  );
}
