'use client';

import { AlertCircleIcon, CheckCircle2Icon, ClockIcon } from 'lucide-react';
import Link from 'next/link';

import { useAsyncAction } from '@/hooks/use-async-action';
import { errorMessage } from '@/lib/api-error';
import type { OrderDetail } from '@/lib/checkout/types';
import { useStartPayment } from '@/lib/checkout/use-checkout';

const BOX_CLASS = 'flex items-start gap-3 border border-border p-5';
const BODY_CLASS = 'min-w-0 text-sm leading-6';

/**
 * What an online order is waiting for, from what the server recorded. Coming back from the gateway
 * (`returned`) only changes the wording: it is not evidence of anything (invariant 4), which is why
 * a successful return with no confirmation yet says "confirming" and never "paid".
 *
 * While the order waits, `useOrder` polls, so this moves on by itself once evidence arrives.
 */
export function OnlinePaymentNotice({
  order,
  returned,
}: {
  order: OrderDetail;
  returned: boolean;
}) {
  const { payment } = order;

  if (!payment) return null;

  if (order.status === 'PAYMENT_FAILED') {
    return order.paymentStatus === 'PAID' ? (
      <div role="alert" className={BOX_CLASS}>
        <AlertCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className={BODY_CLASS}>
          <p className="font-medium">Your payment arrived after this order closed.</p>
          <p className="text-muted-foreground">
            The items are no longer available, so this order cannot go ahead. It has been flagged
            for a refund, and there is no need to do anything.
          </p>
        </div>
      </div>
    ) : (
      <div role="alert" className={BOX_CLASS}>
        <AlertCircleIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className={BODY_CLASS}>
          <p className="font-medium">This order was closed without payment.</p>
          <p className="text-muted-foreground">
            The payment did not complete. Your items are still in your bag, so you can try again
            with a new order.
          </p>
          <Link href="/cart" className="mt-1 inline-block underline">
            Go to your bag
          </Link>
        </div>
      </div>
    );
  }

  if (order.status !== 'PENDING_PAYMENT') {
    // A cancelled order can still be paid (its refund is on the way), so "paid" alone does not
    // mean "confirmed": the order progress section tells that story instead.
    return returned && order.paymentStatus === 'PAID' && order.status !== 'CANCELLED' ? (
      <div role="status" className={BOX_CLASS}>
        <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className={BODY_CLASS}>
          <p className="font-medium">
            Thank you. We have your payment and your order is confirmed.
          </p>
          <p className="text-muted-foreground">
            You can come back to this order from your account at any time.
          </p>
        </div>
      </div>
    ) : null;
  }

  if (payment.status === 'PROCESSING') {
    return (
      <div role="status" className={BOX_CLASS}>
        <ClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
        <div className={BODY_CLASS}>
          <p className="font-medium">We have your payment and are checking it.</p>
          <p className="text-muted-foreground">
            There is no need to pay again. This page will update once the check is finished.
          </p>
        </div>
      </div>
    );
  }

  return <AwaitingPayment order={order} returned={returned} />;
}

function AwaitingPayment({ order, returned }: { order: OrderDetail; returned: boolean }) {
  const start = useStartPayment();
  const resume = useAsyncAction(start.mutateAsync, { toastOnError: false });
  const canResume = order.payment?.canResume === true;

  const heading = returned
    ? 'We are confirming your payment.'
    : 'Your order is waiting for payment.';
  const detail = returned
    ? 'This usually takes a moment, and this page updates by itself. Please do not pay again unless you left without finishing.'
    : canResume
      ? 'Your items are held for you while you finish paying. If you do not finish, the order closes and they go back on sale.'
      : 'The time to pay has run out, so this order is closing. Your items are still in your bag.';

  return (
    <div role="status" className={BOX_CLASS}>
      <ClockIcon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className={BODY_CLASS}>
        <p className="font-medium">{heading}</p>
        <p className="text-muted-foreground">{detail}</p>

        {resume.error ? (
          <p role="alert" className="mt-2 text-xs text-destructive">
            {errorMessage(resume.error)}
          </p>
        ) : null}

        {canResume ? (
          <button
            type="button"
            disabled={resume.isPending}
            onClick={() => {
              void resume.run(order.id).then((session) => {
                if (session) window.location.assign(session.redirectUrl);
              });
            }}
            className="mt-3 flex h-11 items-center justify-center rounded-md bg-foreground px-6 text-sm font-semibold text-background transition-opacity hover:opacity-85 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring disabled:cursor-not-allowed disabled:opacity-40"
          >
            {resume.isPending ? 'One moment…' : 'Continue to payment'}
          </button>
        ) : null}
      </div>
    </div>
  );
}
