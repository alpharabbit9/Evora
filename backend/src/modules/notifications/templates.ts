/**
 * The words of every email the store sends (ADR 0021). Pure: each function takes what the
 * message needs, already read from the database, and returns a subject, a plain-text body and an
 * HTML body. Nothing here touches the database or the network, so every template is unit tested.
 *
 * Every value that came from a person — a product name, an address, a customer's name — goes
 * through `escapeHtml` before it reaches the HTML body. The plain-text body needs no escaping.
 */
export interface RenderedEmail {
  readonly subject: string;
  readonly text: string;
  readonly html: string;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

const formatters = new Map<string, Intl.NumberFormat>();

/** Same rule as the storefront (`frontend/src/lib/money.ts`): ৳2,850, or ৳2,850.50 with poisha. */
export function formatMoney(amountMinor: number, currency: string): string {
  const digits = amountMinor % 100 === 0 ? 0 : 2;
  const key = `${currency}:${String(digits)}`;
  let formatter = formatters.get(key);

  if (!formatter) {
    formatter = new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
      currencyDisplay: 'narrowSymbol',
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formatters.set(key, formatter);
  }

  return formatter.format(amountMinor / 100);
}

interface Block {
  /** Plain text; escaped for the HTML body. */
  readonly paragraphs?: readonly string[];
  /** Label/value rows, shown as a small table. */
  readonly rows?: readonly (readonly [string, string])[];
  readonly link?: { readonly label: string; readonly url: string };
}

/** Who the email is from, as the store settings say (ADR 0022). */
export interface StoreIdentity {
  readonly storeName: string;
  /** Shown in the footer when set, so a customer knows where to write. */
  readonly supportEmail?: string | null;
}

function compose(
  store: StoreIdentity,
  subject: string,
  heading: string,
  blocks: Block[],
): RenderedEmail {
  const text: string[] = [heading, ''];
  const html: string[] = [];

  for (const block of blocks) {
    for (const paragraph of block.paragraphs ?? []) {
      text.push(paragraph, '');
      html.push(`<p style="margin:0 0 16px">${escapeHtml(paragraph)}</p>`);
    }

    if (block.rows && block.rows.length > 0) {
      const width = Math.max(...block.rows.map(([label]) => label.length));
      for (const [label, value] of block.rows) text.push(`${label.padEnd(width)}  ${value}`);
      text.push('');
      html.push(
        '<table role="presentation" style="border-collapse:collapse;margin:0 0 16px;width:100%">',
        ...block.rows.map(
          ([label, value]) =>
            `<tr><td style="padding:4px 12px 4px 0;color:#555;vertical-align:top">${escapeHtml(
              label,
            )}</td><td style="padding:4px 0;text-align:right;vertical-align:top">${escapeHtml(
              value,
            )}</td></tr>`,
        ),
        '</table>',
      );
    }

    if (block.link) {
      text.push(`${block.link.label}: ${block.link.url}`, '');
      html.push(
        `<p style="margin:0 0 16px"><a href="${escapeHtml(block.link.url)}" style="color:#111">${escapeHtml(
          block.link.label,
        )}</a></p>`,
      );
    }
  }

  const { storeName, supportEmail } = store;
  if (supportEmail) text.push(`Questions? Write to ${supportEmail}`, '');
  text.push('—', storeName);

  return {
    subject,
    text: text.join('\n'),
    html: [
      '<!doctype html><html><body style="margin:0;padding:24px;background:#f6f5f2;font-family:Arial,Helvetica,sans-serif;color:#111;font-size:15px;line-height:1.5">',
      '<div style="max-width:560px;margin:0 auto;background:#ffffff;padding:24px;border-radius:8px">',
      `<h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>`,
      ...html,
      supportEmail
        ? `<p style="margin:24px 0 0;color:#555;font-size:13px">Questions? Write to <a href="mailto:${escapeHtml(supportEmail)}" style="color:#555">${escapeHtml(supportEmail)}</a></p>`
        : '',
      `<p style="margin:${supportEmail ? '8px' : '24px'} 0 0;color:#555;font-size:13px">${escapeHtml(storeName)}</p>`,
      '</div></body></html>',
    ].join(''),
  };
}

// ---------------------------------------------------------------------------
// Customer messages
// ---------------------------------------------------------------------------

export interface OrderSummaryView {
  readonly storeName: string;
  readonly supportEmail?: string | null;
  readonly orderNumber: string;
  /** Null when the customer has no page to go to (a guest order, which v1 does not take). */
  readonly orderUrl: string | null;
  readonly recipientName: string;
}

export interface ReceiptView extends OrderSummaryView {
  readonly paymentMethod: 'COD' | 'ONLINE';
  readonly currency: string;
  readonly items: readonly {
    readonly name: string;
    readonly options: string | null;
    readonly quantity: number;
    readonly lineTotalMinor: number;
  }[];
  readonly subtotalMinor: number;
  readonly discountMinor: number;
  readonly shippingMinor: number;
  readonly taxMinor: number;
  readonly totalMinor: number;
  readonly shipTo: readonly string[];
}

function orderLink(view: OrderSummaryView): Block[] {
  return view.orderUrl ? [{ link: { label: 'View your order', url: view.orderUrl } }] : [];
}

export function receiptEmail(view: ReceiptView): RenderedEmail {
  const money = (minor: number) => formatMoney(minor, view.currency);
  const totals: [string, string][] = [['Subtotal', money(view.subtotalMinor)]];

  if (view.discountMinor > 0) totals.push(['Discount', `−${money(view.discountMinor)}`]);
  totals.push(['Delivery', view.shippingMinor === 0 ? 'Free' : money(view.shippingMinor)]);
  if (view.taxMinor > 0) totals.push(['Tax', money(view.taxMinor)]);
  totals.push(['Total', money(view.totalMinor)]);

  return compose(view, `Order ${view.orderNumber} confirmed`, 'Thank you for your order', [
    {
      paragraphs: [
        `Hello ${view.recipientName}, we have your order ${view.orderNumber}.`,
        view.paymentMethod === 'COD'
          ? `Please have ${money(view.totalMinor)} ready: you pay in cash when it is delivered.`
          : 'Your payment has been received.',
      ],
    },
    {
      rows: view.items.map((item) => [
        `${item.name}${item.options ? ` (${item.options})` : ''} × ${String(item.quantity)}`,
        money(item.lineTotalMinor),
      ]),
    },
    { rows: totals },
    { paragraphs: ['Delivering to:', view.shipTo.join(', ')] },
    ...orderLink(view),
  ]);
}

export interface ShippingView extends OrderSummaryView {
  readonly status: 'SHIPPED' | 'DELIVERED';
  readonly carrier: string | null;
  readonly trackingNumber: string | null;
}

export function shippingEmail(view: ShippingView): RenderedEmail {
  const shipped = view.status === 'SHIPPED';
  const tracking: [string, string][] = [];

  if (view.carrier) tracking.push(['Carrier', view.carrier]);
  if (view.trackingNumber) tracking.push(['Tracking number', view.trackingNumber]);

  return compose(
    view,
    shipped ? `Order ${view.orderNumber} is on its way` : `Order ${view.orderNumber} was delivered`,
    shipped ? 'Your order is on its way' : 'Your order was delivered',
    [
      {
        paragraphs: [
          shipped
            ? `Hello ${view.recipientName}, order ${view.orderNumber} has left us.`
            : `Hello ${view.recipientName}, order ${view.orderNumber} has been delivered. We hope you enjoy it.`,
        ],
      },
      { rows: tracking },
      ...orderLink(view),
    ],
  );
}

export interface CancelledView extends OrderSummaryView {
  /** True when money was taken online, so a refund follows in its own email. */
  readonly paidOnline: boolean;
}

export function cancelledEmail(view: CancelledView): RenderedEmail {
  return compose(view, `Order ${view.orderNumber} was cancelled`, 'Your order was cancelled', [
    {
      paragraphs: [
        `Hello ${view.recipientName}, order ${view.orderNumber} has been cancelled.`,
        view.paidOnline
          ? 'You paid online, so your money is coming back. We will email you about the refund.'
          : 'You have not been charged.',
      ],
    },
    ...orderLink(view),
  ]);
}

export interface RefundView extends OrderSummaryView {
  readonly stage: 'requested' | 'succeeded';
  readonly amountMinor: number;
  readonly currency: string;
  /** Cash goes back by hand; an online refund goes back to the account that paid. */
  readonly cash: boolean;
}

export function refundEmail(view: RefundView): RenderedEmail {
  const amount = formatMoney(view.amountMinor, view.currency);
  const done = view.stage === 'succeeded';

  return compose(
    view,
    done
      ? `Refund for order ${view.orderNumber} completed`
      : `Refund for order ${view.orderNumber} started`,
    done ? 'Your refund is complete' : 'Your refund has started',
    [
      {
        paragraphs: [
          done
            ? `Hello ${view.recipientName}, we have refunded ${amount} for order ${view.orderNumber}.`
            : `Hello ${view.recipientName}, we have started a refund of ${amount} for order ${view.orderNumber}.`,
          view.cash
            ? 'It was returned to you in cash.'
            : done
              ? 'It goes back to the account you paid with. Your bank or wallet may take a few days to show it.'
              : 'It goes back to the account you paid with. We will email you again when it is complete.',
        ],
      },
      ...orderLink(view),
    ],
  );
}

export interface AuthLinkView {
  readonly storeName: string;
  readonly supportEmail?: string | null;
  readonly recipientName: string;
  readonly url: string;
}

export function passwordResetEmail(view: AuthLinkView): RenderedEmail {
  return compose(view, 'Reset your password', 'Reset your password', [
    {
      paragraphs: [
        `Hello ${view.recipientName}, someone asked to reset the password for your account.`,
        'The link below works once and expires in one hour. If it was not you, ignore this email: your password stays as it is.',
      ],
    },
    { link: { label: 'Choose a new password', url: view.url } },
  ]);
}

export function verificationEmail(view: AuthLinkView): RenderedEmail {
  return compose(view, 'Confirm your email address', 'Confirm your email address', [
    {
      paragraphs: [
        `Hello ${view.recipientName}, please confirm this is your email address.`,
        'The link below expires in 24 hours. If you did not create an account, ignore this email.',
      ],
    },
    { link: { label: 'Confirm my email', url: view.url } },
  ]);
}

// ---------------------------------------------------------------------------
// Staff alerts
// ---------------------------------------------------------------------------

export interface LowStockView {
  readonly storeName: string;
  readonly supportEmail?: string | null;
  readonly productName: string | null;
  readonly sku: string;
  readonly stockAtAlert: number;
  readonly stockNow: number | null;
  readonly threshold: number;
  readonly inventoryUrl: string;
}

export function lowStockEmail(view: LowStockView): RenderedEmail {
  const rows: [string, string][] = [
    ['SKU', view.sku],
    ['Stock when raised', String(view.stockAtAlert)],
  ];

  if (view.stockNow !== null && view.stockNow !== view.stockAtAlert) {
    rows.push(['Stock now', String(view.stockNow)]);
  }
  rows.push(['Threshold', String(view.threshold)]);

  return compose(view, `Low stock: ${view.sku}`, 'Stock is running low', [
    {
      paragraphs: [`${view.productName ?? 'A variant'} has reached its low-stock threshold.`],
    },
    { rows },
    { link: { label: 'Open inventory', url: view.inventoryUrl } },
  ]);
}

const REVIEW_REASONS: Record<string, string> = {
  AMOUNT_MISMATCH: 'The amount paid does not match the order total.',
  RISK_REVIEW: 'The payment provider flagged the payment for a risk review.',
  DUPLICATE_CAPTURE: 'The order appears to have been paid twice.',
  PAID_AFTER_CLOSE: 'Money arrived after the order had closed and its goods were sold.',
  CANCELLED_WHILE_HELD: 'The order was cancelled while its payment was held.',
  REFUND_FAILED: 'The provider would not make a refund, so the customer is still owed money.',
  REFUND_UNCONFIRMED:
    'The provider says a refund may already have started; confirm it before sending another.',
};

export function reviewReasonText(reason: string): string {
  return REVIEW_REASONS[reason] ?? `Reason code: ${reason}.`;
}

export interface PaymentReviewView {
  readonly storeName: string;
  readonly supportEmail?: string | null;
  readonly orderNumber: string;
  readonly reason: string;
  readonly adminOrderUrl: string;
}

export function paymentReviewEmail(view: PaymentReviewView): RenderedEmail {
  return compose(
    view,
    `Payment needs review: order ${view.orderNumber}`,
    'A payment needs a person',
    [
      { paragraphs: [`Order ${view.orderNumber}: ${reviewReasonText(view.reason)}`] },
      { link: { label: 'Open the order', url: view.adminOrderUrl } },
    ],
  );
}
