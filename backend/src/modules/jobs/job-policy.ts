import type { OutboxEventType, OutboxStatus } from '@prisma/client';

/**
 * The rules of the outbox worker (ADR 0021), as pure functions so they are unit tested without a
 * database: how long to wait before a retry, when to give up, how long a claim lasts, and what of a
 * failure is safe to store and show.
 */

/** Tries before a one-off job is DEAD. With the delays below, about an hour of retrying. */
export const MAX_ATTEMPTS = 8;

/** First retry after 30–60 s; each later one doubles, up to 30–60 min. */
export const RETRY_BASE_MS = 30_000;
export const RETRY_CAP_MS = 60 * 60 * 1000;

/**
 * Recurring work: the payment and refund sweep, and the shopping assistant's index sweep and
 * retention purge (ADR 0025). Rescheduled after every run, never DEAD.
 */
export const RECURRING_TYPES: ReadonlySet<OutboxEventType> = new Set([
  'PAYMENT_RECONCILIATION',
  'ASSISTANT_INDEX_SWEEP',
  'ASSISTANT_RETENTION',
]);

export const RECONCILIATION_DEDUPE_KEY = 'recurring:payment-reconciliation';
export const ASSISTANT_INDEX_DEDUPE_KEY = 'recurring:assistant-index';
export const ASSISTANT_RETENTION_DEDUPE_KEY = 'recurring:assistant-retention';

/**
 * How long a claim lasts. A worker that dies mid-try loses its rows when this runs out, and
 * another worker takes them over. Each try is bounded well inside it (`HANDLER_TIMEOUT_MS`), so a
 * live worker never loses a row it is still working on.
 */
export function leaseMs(type: OutboxEventType): number {
  return RECURRING_TYPES.has(type) ? 15 * 60 * 1000 : 5 * 60 * 1000;
}

/** The longest one try may take before it counts as failed. */
export function handlerTimeoutMs(type: OutboxEventType): number {
  return RECURRING_TYPES.has(type) ? 12 * 60 * 1000 : 2 * 60 * 1000;
}

/**
 * Bounded exponential backoff with "equal" jitter: half the delay is fixed and half random, so
 * retries from many rows spread out (architecture.md §11) while none comes back immediately.
 * `attempt` is the try that just failed, 1-based.
 */
export function retryDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(RETRY_CAP_MS, RETRY_BASE_MS * 2 ** Math.max(0, attempt - 1));
  const half = exponential / 2;

  return Math.round(half + Math.min(1, Math.max(0, random())) * half);
}

/** A failure that no retry can fix: the order is gone, the link expired, the address is refused. */
export class PermanentJobError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = 'PermanentJobError';
  }
}

export interface FailureInput {
  readonly eventType: OutboxEventType;
  /** Including the try that just failed. */
  readonly attemptCount: number;
  readonly permanent: boolean;
  readonly now: Date;
  readonly recurringIntervalMs: number;
  readonly random?: () => number;
}

export interface FailureDecision {
  readonly status: Extract<OutboxStatus, 'FAILED' | 'DEAD'>;
  readonly nextAttemptAt: Date;
}

export function decideFailure(input: FailureInput): FailureDecision {
  const delay = retryDelayMs(input.attemptCount, input.random);

  if (RECURRING_TYPES.has(input.eventType)) {
    // Never given up on: a sweep that stopped for good would strand paid orders. It retries
    // sooner than its interval, and the admin summary shows how long it has been failing.
    return {
      status: 'FAILED',
      nextAttemptAt: new Date(input.now.getTime() + Math.min(delay, input.recurringIntervalMs)),
    };
  }

  if (input.permanent || input.attemptCount >= MAX_ATTEMPTS) {
    return { status: 'DEAD', nextAttemptAt: input.now };
  }

  return { status: 'FAILED', nextAttemptAt: new Date(input.now.getTime() + delay) };
}

const EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const URL_PATTERN = /\bhttps?:\/\/[^\s"'<>]+/gi;
const MAX_ERROR_LENGTH = 500;

/**
 * What of a failure may be stored in `last_error` and shown on the dashboard. Relay responses
 * often quote the recipient's address, and an error could carry a reset link, so both are
 * removed; the rest is shortened (the column's CHECK allows 1000).
 */
export function safeErrorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const cleaned = raw
    .replace(URL_PATTERN, '[url]')
    .replace(EMAIL_PATTERN, '[email]')
    .replace(/\s+/g, ' ')
    .trim();

  return cleaned.length > MAX_ERROR_LENGTH
    ? `${cleaned.slice(0, MAX_ERROR_LENGTH - 1)}…`
    : cleaned || 'Unknown error';
}

/**
 * Types whose payload carries a secret (a reset or verification link). It is replaced once the
 * row is finished, SENT or DEAD, so a database reader cannot use it (`auth-email.ts`).
 */
export const SCRUB_ON_FINISH: ReadonlySet<OutboxEventType> = new Set([
  'PASSWORD_RESET',
  'EMAIL_VERIFICATION',
]);

/** True once the secret has been removed: such a row can never be sent again. */
export function isScrubbed(payload: unknown): boolean {
  return typeof payload === 'object' && payload !== null && 'scrubbed' in payload;
}

export function scrubbedPayload(payload: unknown): { userId?: string; scrubbed: true } {
  const userId =
    typeof payload === 'object' && payload !== null && 'userId' in payload
      ? payload.userId
      : undefined;

  return typeof userId === 'string' ? { userId, scrubbed: true } : { scrubbed: true };
}

const SUBJECT_KEYS = [
  'orderId',
  'orderNumber',
  'refundId',
  'paymentId',
  'variantId',
  'sku',
] as const;

export type JobSubject = Partial<Record<(typeof SUBJECT_KEYS)[number], string>>;

/**
 * What a job is about, for the dashboard: identifiers only, from an allow-list, so an email
 * address or a link in a payload is never returned by the API.
 */
export function jobSubject(payload: unknown): JobSubject {
  if (typeof payload !== 'object' || payload === null) return {};

  const subject: JobSubject = {};
  for (const key of SUBJECT_KEYS) {
    const value = (payload as Record<string, unknown>)[key];
    if (typeof value === 'string' && value.length <= 200) subject[key] = value;
  }

  return subject;
}
