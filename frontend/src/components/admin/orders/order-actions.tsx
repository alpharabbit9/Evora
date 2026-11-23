'use client';

import { useRef, useState } from 'react';

import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { useAsyncAction } from '@/hooks/use-async-action';
import {
  useRecordCodCollection,
  useRefundOrder,
  useResolveHold,
  useTransitionOrder,
} from '@/lib/admin/api';
import { isMajorAmount, majorToMinor, minorToMajor } from '@/lib/admin/price';
import { FAILURE_CODE_LABEL, type AdminOrder } from '@/lib/admin/types';
import { newIdempotencyKey } from '@/lib/api-client';
import type { OrderStatus } from '@/lib/checkout/types';
import { formatMoney } from '@/lib/money';

import { ConfirmDialog, FormActions, FormError, FormField } from '../admin-ui';
import { ORDER_STATUS_ADMIN, TRANSITION_ACTION } from './order-labels';

/**
 * The things an operator can do to one order. Each button only appears when the API would accept
 * it (`allowedTransitions`, payment state), but that is a convenience: the API checks every one
 * again, and its refusal is shown in the dialog that asked.
 */

/** What the paid payment can still give back: paid, less refunds pending or done. */
export function refundableMinor(order: AdminOrder): { paymentId: string; minor: number } | null {
  const paid = [...order.payments]
    .reverse()
    .find((payment) => payment.status === 'SUCCEEDED' || payment.status === 'PARTIALLY_REFUNDED');

  if (!paid) return null;

  const committed = order.refundsDetail
    .filter((refund) => refund.paymentId === paid.id && refund.status !== 'FAILED')
    .reduce((sum, refund) => sum + refund.amountMinor, 0);

  return { paymentId: paid.id, minor: Math.max(paid.amountMinor - committed, 0) };
}

export function TransitionButtons({ order }: { order: AdminOrder }) {
  const [target, setTarget] = useState<OrderStatus | null>(null);

  if (order.allowedTransitions.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">Nothing left to do: this order is closed.</p>
    );
  }

  return (
    <div className="flex flex-wrap gap-2">
      {order.allowedTransitions.map((to) => (
        <Button
          key={to}
          type="button"
          variant={to === 'CANCELLED' ? 'outline' : 'default'}
          className={to === 'CANCELLED' ? 'text-destructive' : undefined}
          onClick={() => {
            setTarget(to);
          }}
        >
          {TRANSITION_ACTION[to] ?? ORDER_STATUS_ADMIN[to].label}
        </Button>
      ))}
      {target ? (
        <TransitionDialog
          order={order}
          to={target}
          onClose={() => {
            setTarget(null);
          }}
        />
      ) : null}
    </div>
  );
}

function TransitionDialog({
  order,
  to,
  onClose,
}: {
  order: AdminOrder;
  to: OrderStatus;
  onClose: () => void;
}) {
  const transition = useTransitionOrder(order.id);
  const action = useAsyncAction(transition.mutateAsync, {
    toastOnError: false,
    successMessage: `Order ${order.orderNumber}: ${ORDER_STATUS_ADMIN[to].label.toLowerCase()}.`,
    onSuccess: onClose,
  });
  const [note, setNote] = useState('');
  const [carrier, setCarrier] = useState('');
  const [tracking, setTracking] = useState('');
  const isCancel = to === 'CANCELLED';
  const refundable = refundableMinor(order);

  const consequence = isCancel
    ? [
        'Its items go back on sale.',
        refundable && refundable.minor > 0
          ? order.paymentMethod === 'COD'
            ? `The ${formatMoney(refundable.minor, order.currency)} collected in cash is recorded as handed back.`
            : `${formatMoney(refundable.minor, order.currency)} is refunded to the customer through SSLCOMMERZ.`
          : 'Nothing has been paid, so there is nothing to refund.',
        'This cannot be undone.',
      ].join(' ')
    : to === 'SHIPPED'
      ? 'The customer sees the carrier and tracking number on their order page.'
      : `The order moves from ${ORDER_STATUS_ADMIN[order.status].label} to ${ORDER_STATUS_ADMIN[to].label}.`;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>
          {TRANSITION_ACTION[to] ?? ORDER_STATUS_ADMIN[to].label}: {order.orderNumber}
        </DialogTitle>
        <DialogDescription>{consequence}</DialogDescription>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run({
              // What is on screen: the API refuses if someone else moved the order meanwhile.
              from: order.status,
              to,
              ...(note.trim() ? { note: note.trim() } : {}),
              ...(to === 'SHIPPED' && carrier.trim() ? { carrier: carrier.trim() } : {}),
              ...(to === 'SHIPPED' && tracking.trim() ? { trackingNumber: tracking.trim() } : {}),
            });
          }}
        >
          {to === 'SHIPPED' ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <FormField label="Carrier (optional)">
                {(control) => (
                  <Input
                    {...control}
                    value={carrier}
                    maxLength={80}
                    placeholder="Pathao, RedX…"
                    onChange={(event) => {
                      setCarrier(event.target.value);
                    }}
                  />
                )}
              </FormField>
              <FormField label="Tracking number (optional)">
                {(control) => (
                  <Input
                    {...control}
                    value={tracking}
                    maxLength={120}
                    onChange={(event) => {
                      setTracking(event.target.value);
                    }}
                  />
                )}
              </FormField>
            </div>
          ) : null}

          <FormField
            label={isCancel ? 'Reason' : 'Note (optional)'}
            hint={
              isCancel
                ? 'Kept in the order history. The customer does not see it.'
                : 'Kept in the order history.'
            }
          >
            {(control) => (
              <Textarea
                {...control}
                required={isCancel}
                value={note}
                maxLength={500}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel={TRANSITION_ACTION[to] ?? 'Save'}
            pendingLabel="Saving…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** Cash on delivery is collected by the courier; this records that the store has it. */
export function CodCollection({ order }: { order: AdminOrder }) {
  const [open, setOpen] = useState(false);
  const collect = useRecordCodCollection(order.id);
  const action = useAsyncAction(collect.mutateAsync, {
    toastOnError: false,
    successMessage: 'Cash recorded as collected.',
    onSuccess: () => {
      setOpen(false);
    },
  });

  const due =
    order.paymentMethod === 'COD' &&
    order.paymentStatus === 'COD_PENDING' &&
    (order.status === 'SHIPPED' || order.status === 'DELIVERED');

  if (!due) return null;

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
        Record cash collected
      </Button>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        title={`Cash collected for ${order.orderNumber}?`}
        description={`Confirm that ${formatMoney(order.totalMinor, order.currency)} in cash has reached the store. This marks the order paid.`}
        confirmLabel="Record cash collected"
        pendingLabel="Recording…"
        isPending={action.isPending}
        error={action.error}
        onConfirm={() => {
          void action.run();
        }}
      />
    </>
  );
}

export function RefundButton({ order }: { order: AdminOrder }) {
  const [open, setOpen] = useState(false);
  const refundable = refundableMinor(order);

  if (!refundable || refundable.minor <= 0) return null;

  return (
    <>
      <Button
        type="button"
        variant="outline"
        onClick={() => {
          setOpen(true);
        }}
      >
        Issue refund
      </Button>
      {open ? (
        <RefundDialog
          order={order}
          maxMinor={refundable.minor}
          onClose={() => {
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function RefundDialog({
  order,
  maxMinor,
  onClose,
}: {
  order: AdminOrder;
  maxMinor: number;
  onClose: () => void;
}) {
  // One key for this refund, made when the dialog opens: a retry after a lost response finds
  // the first refund instead of making a second.
  const key = useRef(newIdempotencyKey());
  const refund = useRefundOrder(order.id);
  const action = useAsyncAction(refund.mutateAsync, {
    toastOnError: false,
    successMessage: (result) =>
      result.status === 'SUCCEEDED'
        ? 'Refund recorded.'
        : result.status === 'FAILED'
          ? 'SSLCOMMERZ refused the refund. It is flagged for review.'
          : 'Refund sent. It completes when the bank confirms it.',
    onSuccess: onClose,
  });
  const [amount, setAmount] = useState(minorToMajor(maxMinor));
  const [reason, setReason] = useState('');
  const [amountError, setAmountError] = useState<string | undefined>();
  const isCash = order.paymentMethod === 'COD';

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>Refund {order.orderNumber}</DialogTitle>
        <DialogDescription>
          {isCash
            ? 'Cash refunds are handed back outside the system. This records that it was done.'
            : 'Sent to the customer through SSLCOMMERZ. It usually completes within a few working days.'}{' '}
          Up to {formatMoney(maxMinor, order.currency)} can still be refunded.
        </DialogDescription>

        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            const typed = amount.trim();

            if (!isMajorAmount(typed) || majorToMinor(typed) < 1) {
              setAmountError('Enter an amount such as 250 or 250.50');
              return;
            }

            if (majorToMinor(typed) > maxMinor) {
              setAmountError(`At most ${formatMoney(maxMinor, order.currency)}`);
              return;
            }

            setAmountError(undefined);
            void action.run({
              key: key.current,
              body: { amountMinor: majorToMinor(typed), reason: reason.trim() },
            });
          }}
        >
          <FormField label={`Amount (${order.currency})`} error={amountError}>
            {(control) => (
              <Input
                {...control}
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormField label="Reason" hint="Sent to SSLCOMMERZ with the refund.">
            {(control) => (
              <Textarea
                {...control}
                required
                value={reason}
                maxLength={255}
                onChange={(event) => {
                  setReason(event.target.value);
                }}
              />
            )}
          </FormField>

          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel="Issue refund"
            pendingLabel="Refunding…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** A payment the state machine held (ADR 0019): a person decides whether the order goes ahead. */
export function HeldPaymentPanel({ order }: { order: AdminOrder }) {
  const held = order.payments.find((payment) => payment.status === 'PROCESSING');
  const [decision, setDecision] = useState<'accept' | 'reject' | null>(null);

  if (!held) return null;

  const isRisk = held.failureCode === 'RISK_REVIEW';

  return (
    <section
      aria-labelledby="held-payment"
      className="flex flex-col gap-3 rounded-lg border border-amber-500/40 bg-amber-500/10 p-4"
    >
      <h2 id="held-payment" className="text-sm font-semibold">
        Payment held for review
      </h2>
      <p className="text-sm">
        {FAILURE_CODE_LABEL[held.failureCode ?? ''] ?? 'Held by the payment checks'}.{' '}
        {isRisk
          ? 'Accept it to go ahead with the order, or reject it to cancel and refund.'
          : 'It cannot be accepted, because it was not paid in full. Rejecting cancels the order; what was received must then be returned from the SSLCOMMERZ panel.'}
      </p>
      <div className="flex flex-wrap gap-2">
        {isRisk ? (
          <Button
            type="button"
            onClick={() => {
              setDecision('accept');
            }}
          >
            Accept payment
          </Button>
        ) : null}
        <Button
          type="button"
          variant="outline"
          className="text-destructive"
          onClick={() => {
            setDecision('reject');
          }}
        >
          Reject and cancel
        </Button>
      </div>
      {decision ? (
        <HoldDialog
          order={order}
          paymentId={held.id}
          decision={decision}
          onClose={() => {
            setDecision(null);
          }}
        />
      ) : null}
    </section>
  );
}

function HoldDialog({
  order,
  paymentId,
  decision,
  onClose,
}: {
  order: AdminOrder;
  paymentId: string;
  decision: 'accept' | 'reject';
  onClose: () => void;
}) {
  const resolve = useResolveHold(order.id);
  const action = useAsyncAction(resolve.mutateAsync, {
    toastOnError: false,
    successMessage:
      decision === 'accept' ? 'Payment accepted.' : 'Payment rejected and order cancelled.',
    onSuccess: onClose,
  });
  const [note, setNote] = useState('');

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !action.isPending) onClose();
      }}
    >
      <DialogContent className="max-w-md">
        <DialogTitle>
          {decision === 'accept' ? 'Accept this payment?' : 'Reject this payment?'}
        </DialogTitle>
        <DialogDescription>
          {decision === 'accept'
            ? 'The order is confirmed and goes ahead as if the payment had passed its checks.'
            : 'The order is cancelled and its items go back on sale. This cannot be undone.'}
        </DialogDescription>
        <form
          className="flex flex-col gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void action.run({ paymentId, decision, note: note.trim() });
          }}
        >
          <FormField label="What you checked" hint="Kept in the audit log.">
            {(control) => (
              <Textarea
                {...control}
                required
                value={note}
                maxLength={500}
                onChange={(event) => {
                  setNote(event.target.value);
                }}
              />
            )}
          </FormField>
          <FormError error={action.error} />
          <FormActions
            isPending={action.isPending}
            submitLabel={decision === 'accept' ? 'Accept payment' : 'Reject and cancel'}
            pendingLabel="Saving…"
            onCancel={onClose}
          />
        </form>
      </DialogContent>
    </Dialog>
  );
}
