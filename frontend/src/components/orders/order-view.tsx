'use client';

import { CheckCircle2Icon } from 'lucide-react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

import { CART_COLUMNS } from '@/components/cart/cart-skeleton';
import { ProductImage } from '@/components/catalog/product-image';
import { QueryState } from '@/components/common/query-state';
import { useOrder } from '@/lib/checkout/use-checkout';
import type { OrderDetail, OrderLine } from '@/lib/checkout/types';
import { formatMoney } from '@/lib/money';

import {
  DELIVERY_METHOD_LABEL,
  ORDER_STATUS_LABEL,
  PAYMENT_STATUS_LABEL,
  formatOrderDate,
} from './order-format';
import { CancelOrder } from './cancel-order';
import { OnlinePaymentNotice } from './online-payment-notice';
import { OrderProgress } from './order-progress';
import { OrderSkeleton } from './order-skeleton';

const SECTION_LABEL = 'text-[10px] font-semibold tracking-[0.24em] text-muted-foreground uppercase';

/**
 * One order, read from the API rather than carried over from checkout: what is shown here is
 * what was persisted (FR-03), and the page works the same when reopened later. `?placed=1` only
 * adds the thank-you line; it decides nothing.
 *
 * It does not say a confirmation email was sent, because none is yet: the receipt waits in the
 * outbox until M9 delivers it.
 */
export function OrderView({ orderId }: { orderId: string }) {
  const order = useOrder(orderId);
  const searchParams = useSearchParams();
  const justPlaced = searchParams.get('placed') === '1';
  const returned = searchParams.get('payment') === 'returned';

  return (
    <QueryState query={order} pending={<OrderSkeleton />} errorTitle="We couldn't load this order">
      {(data) => <OrderContents order={data} justPlaced={justPlaced} returned={returned} />}
    </QueryState>
  );
}

function OrderContents({
  order,
  justPlaced,
  returned,
}: {
  order: OrderDetail;
  justPlaced: boolean;
  returned: boolean;
}) {
  const { shipping, contact } = order;
  const isCod = order.paymentMethod === 'COD';

  return (
    <div className="flex flex-col gap-10">
      {/* An online order is not placed in the thank-you sense until it is paid. */}
      {justPlaced && isCod ? (
        <div role="status" className="flex items-start gap-3 border border-border p-5">
          <CheckCircle2Icon className="mt-0.5 size-5 shrink-0" aria-hidden="true" />
          <div className="text-sm leading-6">
            <p className="font-medium">Thank you. Your order is placed.</p>
            <p className="text-muted-foreground">
              Keep your order number handy. You can come back to this order from your account at any
              time.
            </p>
          </div>
        </div>
      ) : null}

      <OnlinePaymentNotice order={order} returned={returned} />

      <dl className="grid gap-x-10 gap-y-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <div>
          <dt className={SECTION_LABEL}>Order number</dt>
          <dd className="mt-1.5 font-mono text-[13px]">{order.orderNumber}</dd>
        </div>
        <div>
          <dt className={SECTION_LABEL}>Placed</dt>
          <dd className="mt-1.5">{formatOrderDate(order.placedAt)}</dd>
        </div>
        <div>
          <dt className={SECTION_LABEL}>Status</dt>
          <dd className="mt-1.5">{ORDER_STATUS_LABEL[order.status]}</dd>
        </div>
        <div>
          <dt className={SECTION_LABEL}>Payment</dt>
          <dd className="mt-1.5">{PAYMENT_STATUS_LABEL[order.paymentStatus]}</dd>
        </div>
      </dl>

      <div className={CART_COLUMNS}>
        <div className="flex flex-col gap-10">
          <OrderProgress order={order} />

          <section aria-labelledby="order-items">
            <h2 id="order-items" className={SECTION_LABEL}>
              Items
            </h2>
            <ul className="mt-4 divide-y divide-border border-y border-border">
              {order.items.map((line) => (
                <li key={line.id}>
                  <OrderLineRow line={line} currency={order.currency} />
                </li>
              ))}
            </ul>
          </section>

          <div className="grid gap-8 text-sm leading-6 sm:grid-cols-2">
            <section aria-labelledby="order-shipping">
              <h2 id="order-shipping" className={SECTION_LABEL}>
                Delivering to
              </h2>
              <address className="mt-3 not-italic">
                {shipping.recipientName}
                <br />
                {shipping.line1}
                {shipping.line2 ? (
                  <>
                    <br />
                    {shipping.line2}
                  </>
                ) : null}
                <br />
                {[shipping.city, shipping.state, shipping.postalCode].filter(Boolean).join(', ')}
              </address>
              {shipping.method ? (
                <p className="mt-2 text-muted-foreground">
                  {DELIVERY_METHOD_LABEL[shipping.method] ?? shipping.method}
                </p>
              ) : null}
            </section>

            <section aria-labelledby="order-contact">
              <h2 id="order-contact" className={SECTION_LABEL}>
                Contact
              </h2>
              <p className="mt-3">
                {contact.email}
                {contact.phone ? (
                  <>
                    <br />
                    {contact.phone}
                  </>
                ) : null}
              </p>
            </section>
          </div>
        </div>

        <aside
          aria-labelledby="order-totals"
          className="self-start border border-border p-6 lg:sticky lg:top-28"
        >
          <h2 id="order-totals" className={SECTION_LABEL}>
            Totals
          </h2>
          <dl className="mt-5 flex flex-col gap-3 text-sm tabular-nums">
            <TotalRow label="Subtotal" value={formatMoney(order.subtotalMinor, order.currency)} />
            {order.discountMinor > 0 ? (
              <TotalRow
                label="Discount"
                value={`−${formatMoney(order.discountMinor, order.currency)}`}
              />
            ) : null}
            <TotalRow label="Delivery" value={formatMoney(order.shippingMinor, order.currency)} />
            {order.taxMinor > 0 ? (
              <TotalRow label="Tax" value={formatMoney(order.taxMinor, order.currency)} />
            ) : null}
            <div className="flex items-baseline justify-between gap-4 border-t border-border pt-3 text-base font-medium">
              <dt>Total</dt>
              <dd>{formatMoney(order.totalMinor, order.currency)}</dd>
            </div>
          </dl>
          {isCod && order.paymentStatus === 'COD_PENDING' ? (
            <p className="mt-5 border-t border-border pt-5 text-xs leading-5 text-muted-foreground">
              Pay {formatMoney(order.totalMinor, order.currency)} in cash when your order arrives.
            </p>
          ) : null}
          <CancelOrder order={order} />
          <Link
            href="/shop"
            className="mt-5 inline-block border-b border-foreground/30 pb-1 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground"
          >
            Continue shopping
          </Link>
        </aside>
      </div>
    </div>
  );
}

function TotalRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt>{label}</dt>
      <dd>{value}</dd>
    </div>
  );
}

function OrderLineRow({ line, currency }: { line: OrderLine; currency: string }) {
  const details = [line.color, line.size ? `Size ${line.size}` : null].filter(Boolean).join(' · ');

  return (
    <div className="flex gap-4 py-5">
      <div className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden bg-muted">
        <ProductImage image={line.image} sizes="80px" />
      </div>
      <div className="flex min-w-0 flex-1 items-start justify-between gap-4 text-sm">
        <div className="min-w-0">
          <p className="leading-snug">{line.productNameSnapshot}</p>
          {details ? <p className="mt-1 text-xs text-muted-foreground">{details}</p> : null}
          <p className="mt-1 text-xs text-muted-foreground tabular-nums">Qty {line.quantity}</p>
        </div>
        <p className="text-right tabular-nums">
          <span className="block">{formatMoney(line.lineTotalMinor, currency)}</span>
          {line.quantity > 1 ? (
            <span className="block text-xs text-muted-foreground">
              {formatMoney(line.unitPriceMinor, currency)} each
            </span>
          ) : null}
        </p>
      </div>
    </div>
  );
}
