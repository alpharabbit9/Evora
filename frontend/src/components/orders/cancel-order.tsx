'use client';

import { useId, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncAction } from '@/hooks/use-async-action';
import { errorMessage } from '@/lib/api-error';
import type { OrderDetail } from '@/lib/checkout/types';
import { useCancelOrder } from '@/lib/checkout/use-checkout';
import { formatMoney } from '@/lib/money';

/**
 * Cancelling asks first, because it cannot be undone, and says what will happen to the money.
 * The button only appears when the server says the order can be cancelled; if it moved on in the
 * meantime (the store started preparing it), the API refuses and the page shows its new state.
 */
export function CancelOrder({ order }: { order: OrderDetail }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const reasonId = useId();
  const cancel = useCancelOrder(order.id);
  const action = useAsyncAction((why: string | undefined) => cancel.mutateAsync(why), {
    toastOnError: false,
    successMessage: 'Your order is cancelled.',
    onSuccess: () => {
      setOpen(false);
    },
  });

  if (!order.canCancel) return null;

  const paid = order.paymentStatus === 'PAID';
  const consequence = paid
    ? `We will refund ${formatMoney(order.totalMinor, order.currency)} to the way you paid. It usually arrives within a few working days.`
    : order.paymentMethod === 'COD'
      ? 'There is nothing to pay. Your items go back on sale.'
      : 'You have not been charged. If a payment is still going through, it will be refunded.';

  return (
    <>
      <button
        type="button"
        onClick={() => {
          action.reset();
          setOpen(true);
        }}
        className="mt-3 block border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
      >
        Cancel order
      </button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          // Closing mid-request would hide whether it worked.
          if (!action.isPending) setOpen(next);
        }}
      >
        <DialogContent className="max-w-md">
          <DialogTitle>Cancel order {order.orderNumber}?</DialogTitle>
          <DialogDescription>{consequence} This cannot be undone.</DialogDescription>

          <div className="flex flex-col gap-1.5">
            <label htmlFor={reasonId} className="text-xs text-muted-foreground">
              Reason (optional)
            </label>
            <Textarea
              id={reasonId}
              value={reason}
              maxLength={500}
              onChange={(event) => {
                setReason(event.target.value);
              }}
            />
          </div>

          {action.error ? (
            <p role="alert" className="rounded-md bg-destructive/10 px-3 py-2 text-destructive">
              {errorMessage(action.error)}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={action.isPending}
              onClick={() => {
                setOpen(false);
              }}
            >
              Keep order
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={action.isPending}
              onClick={() => {
                void action.run(reason.trim() || undefined);
              }}
            >
              {action.isPending ? 'Cancelling…' : 'Cancel order'}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
