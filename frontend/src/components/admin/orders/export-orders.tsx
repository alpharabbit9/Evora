'use client';

import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { useAsyncAction } from '@/hooks/use-async-action';
import { downloadOrdersCsv } from '@/lib/admin/api';
import type { OrderStatus } from '@/lib/checkout/types';

import { FormActions, FormError, FormField } from '../admin-ui';

function isoDay(date: Date): string {
  // The store's day (UTC+6), which is what the API's range means.
  return new Date(date.getTime() + 6 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

/**
 * Orders placed in a date range, as a CSV file (ADR 0022). At most 366 days and 10,000 orders; the
 * API says so rather than cutting the file short. The file holds customers' email addresses, so
 * every export is recorded in the audit log.
 */
export function ExportOrders({ status }: { status: OrderStatus | undefined }) {
  const [open, setOpen] = useState(false);
  // Read once, when the button first renders: the default is the last 30 days.
  const [today] = useState(() => isoDay(new Date()));
  const [from, setFrom] = useState(() => isoDay(new Date(Date.now() - 29 * 86_400_000)));
  const [to, setTo] = useState(today);
  const action = useAsyncAction(downloadOrdersCsv, {
    toastOnError: false,
    successMessage: () => 'Export downloaded.',
    onSuccess: () => {
      setOpen(false);
    },
  });

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          action.reset();
          setOpen(true);
        }}
      >
        Export CSV
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!action.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <form
            className="flex flex-col gap-4"
            onSubmit={(event) => {
              event.preventDefault();
              void action.run({ from, to, ...(status ? { status } : {}) });
            }}
          >
            <DialogTitle>Export orders</DialogTitle>
            <DialogDescription>
              Orders placed between these days{status ? ', with the status filter applied' : ''}.
              The file includes customers&apos; email addresses; the export is recorded.
            </DialogDescription>
            <div className="grid grid-cols-2 gap-3">
              <FormField label="From">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={from}
                    max={to}
                    required
                    onChange={(event) => {
                      setFrom(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField label="To">
                {(control) => (
                  <Input
                    {...control}
                    type="date"
                    value={to}
                    min={from}
                    max={today}
                    required
                    onChange={(event) => {
                      setTo(event.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
            <FormError error={action.error} />
            <FormActions
              isPending={action.isPending}
              submitLabel="Download"
              pendingLabel="Preparing…"
              onCancel={() => {
                setOpen(false);
              }}
            />
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
