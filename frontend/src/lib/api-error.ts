/**
 * The client-side shape of the API's error envelope (API_SPEC.md §1).
 *
 * Everything that talks to the backend throws one of these, so a component never has to
 * guess what it caught: the code decides the handling, `message` is already safe to show,
 * and `details` map straight onto form fields.
 */
export interface ApiErrorDetail {
  field: string;
  issue: string;
}

/**
 * Server codes come from architecture.md §13. The two transport codes are added here,
 * because "the request never arrived" is a different thing from "the server said no".
 */
export const ApiErrorCode = {
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHENTICATED: 'UNAUTHENTICATED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  OUT_OF_STOCK: 'OUT_OF_STOCK',
  COUPON_INVALID: 'COUPON_INVALID',
  IDEMPOTENCY_CONFLICT: 'IDEMPOTENCY_CONFLICT',
  PAYMENT_PENDING: 'PAYMENT_PENDING',
  RATE_LIMITED: 'RATE_LIMITED',
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  /** The request could not be sent or the response was unreadable. */
  NETWORK_ERROR: 'NETWORK_ERROR',
} as const;

export type ApiErrorCodeName = (typeof ApiErrorCode)[keyof typeof ApiErrorCode];

export class ApiError extends Error {
  readonly code: ApiErrorCodeName;
  /** `0` when the request never got a response. */
  readonly status: number;
  readonly details: ApiErrorDetail[];
  /** Echoed by the API so a user-reported problem can be found in the server logs. */
  readonly requestId: string | undefined;

  constructor(
    code: ApiErrorCodeName,
    message: string,
    options: {
      status?: number;
      details?: ApiErrorDetail[];
      requestId?: string;
      cause?: unknown;
    } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'ApiError';
    this.code = code;
    this.status = options.status ?? 0;
    this.details = options.details ?? [];
    this.requestId = options.requestId;
  }
}

export function isApiError(value: unknown): value is ApiError {
  return value instanceof ApiError;
}

/** Fallback copy for a failure that carries no server message. */
const FALLBACK_MESSAGE = 'Something went wrong. Please try again.';

const MESSAGE_BY_CODE: Partial<Record<ApiErrorCodeName, string>> = {
  NETWORK_ERROR: 'We could not reach the server. Check your connection and try again.',
  UNAUTHENTICATED: 'Please sign in to continue.',
  FORBIDDEN: 'You do not have access to this.',
  RATE_LIMITED: 'Too many attempts. Please wait a moment and try again.',
  INTERNAL_ERROR: FALLBACK_MESSAGE,
};

/**
 * A message that is safe to render for anything that was thrown.
 *
 * The API's own messages are written for customers, so they are used as-is; an unexpected
 * value (a bundler error, a thrown string) falls back to generic copy rather than exposing
 * internals in the UI.
 */
export function errorMessage(error: unknown): string {
  if (isApiError(error)) {
    return MESSAGE_BY_CODE[error.code] ?? (error.message || FALLBACK_MESSAGE);
  }

  return FALLBACK_MESSAGE;
}

/**
 * Server validation details keyed by field, ready for `setError` in react-hook-form.
 *
 * Client-side schemas are UX; this is how the server's verdict — the authoritative one —
 * gets back onto the form.
 */
export function fieldErrors(error: unknown): Record<string, string> {
  if (!isApiError(error)) {
    return {};
  }

  const mapped: Record<string, string> = {};

  for (const detail of error.details) {
    mapped[detail.field] ??= detail.issue;
  }

  return mapped;
}

/**
 * Whether repeating the request could plausibly succeed. Used for query retries — never
 * for mutations, which may only be retried when they carry an idempotency key.
 */
export function isRetryableApiError(error: unknown): boolean {
  if (!isApiError(error)) {
    return false;
  }

  if (error.code === ApiErrorCode.NETWORK_ERROR) {
    return true;
  }

  return error.status === 429 || error.status >= 500;
}
