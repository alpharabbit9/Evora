import type { OrderStatus, PaymentStatus } from '@prisma/client';

import type { FailureCode, ProviderStatus } from './provider.js';

/**
 * The payment state machine (API_SPEC.md §9, ADR 0019), as a pure function. Every path that learns
 * something about a payment (webhook, browser return, reconciliation) comes through `decide`, so
 * there is one answer to "what does this news mean?" and it can be tested without a database.
 *
 * Two rules shape the whole table:
 *   1. Money that moved is a fact. A success can overturn a recorded failure; a failure can never
 *      overturn a recorded success. So events can arrive in any order and settle the same way.
 *   2. News that changes nothing is a normal outcome, not an error. That is what makes a repeat
 *      harmless.
 */

/** How long a customer has to pay before stock held for an abandoned order goes back on sale. */
export const PAYMENT_WINDOW_MS = 30 * 60 * 1000;

export type ReviewReason =
  'AMOUNT_MISMATCH' | 'RISK_REVIEW' | 'DUPLICATE_CAPTURE' | 'PAID_AFTER_CLOSE';

export interface PaymentFacts {
  readonly paymentStatus: PaymentStatus;
  readonly orderStatus: OrderStatus;
  readonly providerRef: string | null;
  readonly amountMinor: number;
  readonly currency: string;
}

export type Decision =
  | { readonly type: 'none' }
  /** Paid but not yet trustworthy: no goods released, a person decides. */
  | { readonly type: 'hold'; readonly reason: 'AMOUNT_MISMATCH' | 'RISK_REVIEW' }
  /** Nothing about the payment changes, but a person must look. */
  | { readonly type: 'review'; readonly reason: ReviewReason }
  /** `late` means the order had already closed and its stock had been released. */
  | { readonly type: 'confirm'; readonly late: boolean }
  /** The money is real but the order cannot be revived (cancelled by then). */
  | { readonly type: 'captureOnly' }
  | { readonly type: 'fail'; readonly code: FailureCode };

const OPEN: ReadonlySet<PaymentStatus> = new Set(['PENDING', 'PROCESSING']);
const CLOSED_UNPAID: ReadonlySet<PaymentStatus> = new Set(['FAILED', 'CANCELLED']);

export function decide(facts: PaymentFacts, news: ProviderStatus): Decision {
  const isOpen = OPEN.has(facts.paymentStatus);

  if (news.kind === 'pending') {
    return { type: 'none' };
  }

  if (news.kind === 'failed') {
    return isOpen && facts.orderStatus === 'PENDING_PAYMENT'
      ? { type: 'fail', code: news.code }
      : { type: 'none' };
  }

  // A success. Already recorded?
  if (!isOpen && !CLOSED_UNPAID.has(facts.paymentStatus)) {
    return facts.providerRef && facts.providerRef !== news.providerRef
      ? { type: 'review', reason: 'DUPLICATE_CAPTURE' }
      : { type: 'none' };
  }

  const untrusted: 'AMOUNT_MISMATCH' | 'RISK_REVIEW' | null =
    news.amountMinor !== facts.amountMinor || news.currency !== facts.currency
      ? 'AMOUNT_MISMATCH'
      : news.riskLevel !== 0
        ? 'RISK_REVIEW'
        : null;

  if (untrusted) {
    return isOpen ? { type: 'hold', reason: untrusted } : { type: 'review', reason: untrusted };
  }

  if (isOpen && facts.orderStatus === 'PENDING_PAYMENT') {
    return { type: 'confirm', late: false };
  }

  if (facts.orderStatus === 'PAYMENT_FAILED') {
    return { type: 'confirm', late: true };
  }

  return { type: 'captureOnly' };
}

/** Whether the customer can still be sent to the gateway for this attempt. */
export function canResumePayment(
  facts: {
    readonly paymentStatus: PaymentStatus;
    readonly orderStatus: OrderStatus;
    readonly createdAt: Date;
  },
  now: Date = new Date(),
): boolean {
  return (
    facts.paymentStatus === 'PENDING' &&
    facts.orderStatus === 'PENDING_PAYMENT' &&
    now.getTime() - facts.createdAt.getTime() < PAYMENT_WINDOW_MS
  );
}
