'use client';

import { useAdminOrder } from '@/lib/admin/api';
import {
  FAILURE_CODE_LABEL,
  PAYMENT_STATUS_LABEL,
  REFUND_STATUS_ADMIN_LABEL,
  type AdminOrder,
} from '@/lib/admin/types';
import { formatMoney } from '@/lib/money';

import { AdminPageSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminQueryState,
  Badge,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  formatAdminDateTime,
} from '../admin-ui';
import { CodCollection, HeldPaymentPanel, RefundButton, TransitionButtons } from './order-actions';
import { ORDER_PAYMENT_ADMIN, ORDER_STATUS_ADMIN } from './order-labels';

const CARD = 'flex flex-col gap-3 rounded-lg border border-border bg-card p-4';
const CARD_TITLE = 'text-sm font-semibold';

export function OrderDetailScreen({ orderId }: { orderId: string }) {
  const order = useAdminOrder(orderId);

  return (
    <AdminQueryState
      query={order}
      pending={<AdminPageSkeleton />}
      errorTitle="We couldn't load this order"
      isEmpty={() => false}
    >
      {(data) => <OrderDetail order={data} />}
    </AdminQueryState>
  );
}

function OrderDetail({ order }: { order: AdminOrder }) {
  const { shipping } = order;

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        back={{ href: '/admin/orders', label: 'Orders' }}
        title={`Order ${order.orderNumber}`}
        description={`Placed ${formatAdminDateTime(order.placedAt)} by ${order.customer.email}`}
      />

      <HeldPaymentPanel order={order} />

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="order-state" className={CARD}>
            <h2 id="order-state" className={CARD_TITLE}>
              Status
            </h2>
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={ORDER_STATUS_ADMIN[order.status].tone}>
                {ORDER_STATUS_ADMIN[order.status].label}
              </Badge>
              <Badge tone={ORDER_PAYMENT_ADMIN[order.paymentStatus].tone}>
                {ORDER_PAYMENT_ADMIN[order.paymentStatus].label}
              </Badge>
              <span className="text-xs text-muted-foreground">
                {order.paymentMethod === 'COD' ? 'Cash on delivery' : 'Paid online'}
              </span>
            </div>
            {order.tracking ? (
              <p className="text-sm">
                <span className="text-muted-foreground">Tracking: </span>
                {[order.tracking.carrier, order.tracking.number].filter(Boolean).join(' · ')}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <TransitionButtons order={order} />
              <CodCollection order={order} />
              <RefundButton order={order} />
            </div>
          </section>

          <section aria-labelledby="order-items" className="flex flex-col gap-3">
            <h2 id="order-items" className={CARD_TITLE}>
              Items
            </h2>
            <TableFrame label="Items in this order">
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Product
                  </th>
                  <th scope="col" className={TH}>
                    SKU
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Qty
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Unit
                  </th>
                  <th scope="col" className={`${TH} text-right`}>
                    Total
                  </th>
                </tr>
              </thead>
              <tbody>
                {order.items.map((line) => (
                  <tr key={line.id} className={TBODY_ROW}>
                    <td className={TD}>
                      <span className="block">{line.productNameSnapshot}</span>
                      <span className="block text-xs text-muted-foreground">
                        {[line.color, line.size ? `Size ${line.size}` : null]
                          .filter(Boolean)
                          .join(' · ')}
                      </span>
                    </td>
                    <td className={`${TD} font-mono text-xs`}>{line.skuSnapshot}</td>
                    <td className={`${TD} text-right tabular-nums`}>{line.quantity}</td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {formatMoney(line.unitPriceMinor, order.currency)}
                    </td>
                    <td className={`${TD} text-right tabular-nums`}>
                      {formatMoney(line.lineTotalMinor, order.currency)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <dl className="ml-auto grid w-full max-w-xs grid-cols-2 gap-x-6 gap-y-1 text-sm tabular-nums">
              <dt className="text-muted-foreground">Subtotal</dt>
              <dd className="text-right">{formatMoney(order.subtotalMinor, order.currency)}</dd>
              <dt className="text-muted-foreground">Delivery</dt>
              <dd className="text-right">{formatMoney(order.shippingMinor, order.currency)}</dd>
              {order.discountMinor > 0 ? (
                <>
                  <dt className="text-muted-foreground">Discount</dt>
                  <dd className="text-right">
                    −{formatMoney(order.discountMinor, order.currency)}
                  </dd>
                </>
              ) : null}
              <dt className="font-medium">Total</dt>
              <dd className="text-right font-medium">
                {formatMoney(order.totalMinor, order.currency)}
              </dd>
            </dl>
          </section>

          <section aria-labelledby="order-history" className="flex flex-col gap-3">
            <h2 id="order-history" className={CARD_TITLE}>
              History
            </h2>
            <ol className="flex flex-col gap-3 border-l border-border pl-4">
              {order.history.map((entry, index) => (
                <li key={`${entry.at}-${String(index)}`} className="text-sm">
                  <p>
                    <span className="font-medium">{ORDER_STATUS_ADMIN[entry.toStatus].label}</span>{' '}
                    <span className="text-muted-foreground">
                      · {formatAdminDateTime(entry.at)} ·{' '}
                      {entry.actorEmail ?? (entry.isSystem ? 'System' : 'Unknown')}
                    </span>
                  </p>
                  {entry.reason ? <p className="text-muted-foreground">{entry.reason}</p> : null}
                </li>
              ))}
            </ol>
          </section>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          <section aria-labelledby="order-payments" className={CARD}>
            <h2 id="order-payments" className={CARD_TITLE}>
              Payments
            </h2>
            <ul className="flex flex-col gap-2 text-sm">
              {order.payments.map((payment) => (
                <li key={payment.id} className="flex flex-col gap-0.5">
                  <span className="flex items-center justify-between gap-3">
                    <span>
                      {payment.method === 'COD'
                        ? 'Cash on delivery'
                        : `Online (${payment.provider})`}
                    </span>
                    <span className="tabular-nums">
                      {formatMoney(payment.amountMinor, order.currency)}
                    </span>
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {PAYMENT_STATUS_LABEL[payment.status]}
                    {payment.failureCode
                      ? ` · ${FAILURE_CODE_LABEL[payment.failureCode] ?? payment.failureCode}`
                      : ''}
                  </span>
                </li>
              ))}
            </ul>
          </section>

          {order.refundsDetail.length > 0 ? (
            <section aria-labelledby="order-refunds" className={CARD}>
              <h2 id="order-refunds" className={CARD_TITLE}>
                Refunds
              </h2>
              <ul className="flex flex-col gap-3 text-sm">
                {order.refundsDetail.map((refund) => (
                  <li key={refund.id} className="flex flex-col gap-0.5">
                    <span className="flex items-center justify-between gap-3">
                      <Badge
                        tone={
                          refund.status === 'SUCCEEDED'
                            ? 'success'
                            : refund.status === 'FAILED'
                              ? 'destructive'
                              : 'warning'
                        }
                      >
                        {REFUND_STATUS_ADMIN_LABEL[refund.status]}
                      </Badge>
                      <span className="tabular-nums">
                        {formatMoney(refund.amountMinor, order.currency)}
                      </span>
                    </span>
                    {refund.reason ? (
                      <span className="text-xs text-muted-foreground">{refund.reason}</span>
                    ) : null}
                    <span className="text-xs text-muted-foreground">
                      {formatAdminDateTime(refund.createdAt)}
                      {refund.requestedByEmail ? ` · ${refund.requestedByEmail}` : ''}
                    </span>
                    {refund.status === 'PENDING' && !refund.providerAcknowledged ? (
                      <span className="text-xs text-amber-800 dark:text-amber-300">
                        SSLCOMMERZ has not acknowledged this yet. The payment sweep sends it again
                        with the same reference, so it cannot be refunded twice.
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}

          <section aria-labelledby="order-customer" className={CARD}>
            <h2 id="order-customer" className={CARD_TITLE}>
              Customer and delivery
            </h2>
            <p className="text-sm">
              {order.contact.email}
              {order.contact.phone ? (
                <>
                  <br />
                  {order.contact.phone}
                </>
              ) : null}
            </p>
            <address className="text-sm not-italic">
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
              <p className="text-xs text-muted-foreground">
                {shipping.method === 'express' ? 'Express delivery' : 'Standard delivery'}
              </p>
            ) : null}
          </section>
        </div>
      </div>
    </div>
  );
}
