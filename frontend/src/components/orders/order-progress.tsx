import { CheckIcon } from 'lucide-react';

import type { OrderDetail } from '@/lib/checkout/types';
import { formatMoney } from '@/lib/money';
import { cn } from '@/lib/utils';

import {
  FULFILMENT_STEPS,
  ORDER_STATUS_LABEL,
  REFUND_STATUS_LABEL,
  formatOrderDate,
} from './order-format';

const SECTION_LABEL = 'text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase';

/**
 * Where the order is, from its recorded history (ADR 0020). A delivered-path order shows the four
 * fulfilment steps with the ones reached ticked; a closed order shows what happened instead,
 * because "Shipped: not yet" under a cancelled order would suggest it still might.
 */
export function OrderProgress({ order }: { order: OrderDetail }) {
  const reachedAt = new Map(order.timeline.map((entry) => [entry.status, entry.at]));
  const closed = order.status === 'CANCELLED' || order.status === 'PAYMENT_FAILED';
  const waiting = order.status === 'PENDING_PAYMENT';

  return (
    <section aria-labelledby="order-progress" className="flex flex-col gap-4">
      <h2 id="order-progress" className={SECTION_LABEL}>
        Order progress
      </h2>

      {closed || waiting ? (
        <ol className="flex flex-col gap-2 text-sm">
          {order.timeline.map((entry, index) => (
            <li key={`${entry.status}-${String(index)}`} className="flex justify-between gap-4">
              <span>{ORDER_STATUS_LABEL[entry.status]}</span>
              <span className="text-muted-foreground">{formatOrderDate(entry.at)}</span>
            </li>
          ))}
        </ol>
      ) : (
        <ol className="grid gap-3 sm:grid-cols-4">
          {FULFILMENT_STEPS.map((step) => {
            const at = reachedAt.get(step);

            return (
              <li key={step} className="flex items-start gap-2.5 text-sm">
                <span
                  aria-hidden="true"
                  className={cn(
                    'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                    at ? 'border-foreground bg-foreground text-background' : 'border-border',
                  )}
                >
                  {at ? <CheckIcon className="size-3" /> : null}
                </span>
                <span className="min-w-0">
                  <span className={cn('block', !at && 'text-muted-foreground')}>
                    {ORDER_STATUS_LABEL[step]}
                  </span>
                  <span className="block text-xs text-muted-foreground">
                    {at ? formatOrderDate(at) : 'Not yet'}
                  </span>
                  <span className="sr-only">{at ? ', done' : ', not reached'}</span>
                </span>
              </li>
            );
          })}
        </ol>
      )}

      {order.tracking ? (
        <p className="text-sm">
          <span className="text-muted-foreground">Tracking: </span>
          {[order.tracking.carrier, order.tracking.number].filter(Boolean).join(' · ')}
        </p>
      ) : null}

      {order.refunds.length > 0 ? (
        <div className="flex flex-col gap-2 border-t border-border pt-4">
          <h3 className={SECTION_LABEL}>Refunds</h3>
          <ul className="flex flex-col gap-1.5 text-sm">
            {order.refunds.map((refund) => (
              <li key={refund.id} className="flex flex-wrap justify-between gap-x-4">
                <span className="tabular-nums">
                  {formatMoney(refund.amountMinor, order.currency)}
                </span>
                <span
                  className={
                    refund.status === 'FAILED' ? 'text-destructive' : 'text-muted-foreground'
                  }
                >
                  {REFUND_STATUS_LABEL[refund.status]}
                </span>
              </li>
            ))}
          </ul>
          {order.refunds.some((refund) => refund.status === 'PENDING') ? (
            <p className="text-xs text-muted-foreground">
              Refunds usually reach your card or bKash account within a few working days.
            </p>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
