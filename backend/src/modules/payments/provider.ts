/**
 * What the rest of the store needs from a payment provider, and nothing provider-specific
 * (architecture.md §4). Everything SSLCOMMERZ-shaped stays in `sslcommerz.ts`; adding a second
 * provider means writing another implementation of this interface.
 *
 * `reference` is our payment id, handed to the provider when a session starts and echoed back by
 * it, so any provider message can be matched to one row.
 */
export interface CreateSessionInput {
  readonly reference: string;
  readonly amountMinor: number;
  readonly currency: string;
  readonly productName: string;
  readonly itemCount: number;
  readonly customer: {
    readonly name: string;
    readonly email: string;
    readonly phone: string;
    readonly line1: string;
    readonly city: string;
    readonly postalCode: string;
    readonly countryCode: string;
  };
  readonly returnUrl: string;
  readonly notifyUrl: string;
}

export interface PaymentSession {
  readonly sessionRef: string;
  /** Where the customer goes to pay. They never give us card details. */
  readonly redirectUrl: string;
}

export type FailureCode = 'FAILED' | 'CANCELLED' | 'EXPIRED';

/** The provider's own answer to "what happened to this payment?". */
export type ProviderStatus =
  | {
      readonly kind: 'succeeded';
      readonly providerRef: string;
      /** `null` when the provider's figure could not be read exactly: treated as a mismatch. */
      readonly amountMinor: number | null;
      readonly currency: string | null;
      readonly riskLevel: number;
    }
  | { readonly kind: 'failed'; readonly code: FailureCode }
  /** In progress, or the provider has no record of an attempt yet. */
  | { readonly kind: 'pending' };

/** A notification whose signature checked out. What it claims still gets confirmed. */
export interface VerifiedNotification {
  /** Stable for one fact about one payment, so a resend is recognised as a duplicate. */
  readonly eventId: string;
  readonly eventType: string;
  readonly reference: string;
  readonly claim:
    | { readonly kind: 'succeeded' | 'pending' }
    | { readonly kind: 'failed'; readonly code: FailureCode };
  /** Safe to store: no card, customer or credential field. */
  readonly safeMetadata: Readonly<Record<string, string>>;
}

export interface PaymentProvider {
  readonly name: string;
  /** Inclusive limits on one payment, in minor units. */
  readonly minAmountMinor: number;
  readonly maxAmountMinor: number;
  /** @throws ProviderUnavailableError when the provider cannot be reached or refuses. */
  createSession(input: CreateSessionInput): Promise<PaymentSession>;
  /** `null` means the message is not provably from the provider and must be ignored. */
  verifyNotification(fields: Readonly<Record<string, string>>): VerifiedNotification | null;
  /** @throws ProviderUnavailableError when the answer is unknown. Never guess a status. */
  fetchStatus(reference: string): Promise<ProviderStatus>;
  /**
   * Asks the provider to return money. `refundId` is ours and must be the same on every attempt for
   * one refund, so a provider that recognises repeats can do so.
   *
   * @throws ProviderUnavailableError when it is unknown whether the request arrived. The caller must
   * then retry with the same `refundId`, never with a new one.
   */
  startRefund(input: StartRefundInput): Promise<RefundStart>;
  /** @throws ProviderUnavailableError when the answer is unknown. */
  fetchRefundStatus(providerRefundRef: string): Promise<RefundState>;
}

export interface StartRefundInput {
  readonly refundId: string;
  /** What `ProviderStatus.succeeded.providerRef` was for the payment. */
  readonly providerPaymentRef: string;
  readonly amountMinor: number;
  readonly reason: string;
}

export type RefundStart =
  /** Accepted. Money moves later; `fetchRefundStatus` says when. */
  | { readonly kind: 'started'; readonly providerRefundRef: string }
  /** The provider says a refund for this was started already, but did not say which. */
  | { readonly kind: 'alreadyStarted' }
  /** Refused outright. Nothing will move. */
  | { readonly kind: 'refused' };

export type RefundState = 'refunded' | 'processing' | 'cancelled';

/**
 * The provider could not give an answer: a timeout, a refused connection, a response we cannot
 * read. An unknown outcome, never a failed payment, so callers leave the payment as it is.
 *
 * The message is ours and safe to log. It must not include a request URL, because the status
 * endpoints carry the store password in their query string.
 */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}
