/**
 * Stable API error codes (architecture.md §13) and the response envelopes from
 * API_SPEC.md §1. Domain code throws AppError; the error middleware is the only
 * place that turns one into an HTTP response, so SQL and stack traces cannot leak.
 */
export const ErrorCode = {
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
} as const;

export type ErrorCodeName = (typeof ErrorCode)[keyof typeof ErrorCode];

const statusByCode: Record<ErrorCodeName, number> = {
  VALIDATION_ERROR: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  OUT_OF_STOCK: 409,
  COUPON_INVALID: 409,
  IDEMPOTENCY_CONFLICT: 409,
  PAYMENT_PENDING: 409,
  RATE_LIMITED: 429,
  INTERNAL_ERROR: 500,
};

export interface ErrorDetail {
  field: string;
  issue: string;
}

export class AppError extends Error {
  readonly code: ErrorCodeName;
  readonly status: number;
  readonly details: ErrorDetail[] | undefined;

  constructor(
    code: ErrorCodeName,
    message: string,
    options?: { details?: ErrorDetail[]; cause?: unknown },
  ) {
    super(message, options?.cause === undefined ? undefined : { cause: options.cause });
    this.name = 'AppError';
    this.code = code;
    this.status = statusByCode[code];
    this.details = options?.details;
  }
}

export interface SuccessEnvelope<T> {
  data: T;
  meta: { requestId: string } & Record<string, unknown>;
}

export function success<T>(
  data: T,
  requestId: string,
  meta: Record<string, unknown> = {},
): SuccessEnvelope<T> {
  return { data, meta: { ...meta, requestId } };
}

export function collection<T>(
  data: T[],
  requestId: string,
  page: { page: number; pageSize: number; total: number },
): SuccessEnvelope<T[]> {
  return { data, meta: { ...page, requestId } };
}

export function isAppError(value: unknown): value is AppError {
  return value instanceof AppError;
}

/**
 * Error constructors. Domain services and route handlers throw these instead of
 * assembling an `AppError` by hand, so a given failure always carries the same code,
 * status and default wording — and adding a code in one place updates every caller.
 *
 * Messages are user-facing: they must not name tables, columns, providers or internals.
 */
type ErrorOptions = { details?: ErrorDetail[]; cause?: unknown };

export function validationFailed(
  details: ErrorDetail[],
  message = 'The request could not be processed.',
): AppError {
  return new AppError(ErrorCode.VALIDATION_ERROR, message, { details });
}

export function unauthenticated(
  message = 'Authentication is required.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.UNAUTHENTICATED, message, options);
}

export function forbidden(
  message = 'You do not have permission to perform this action.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.FORBIDDEN, message, options);
}

export function notFound(
  message = 'The requested resource does not exist.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.NOT_FOUND, message, options);
}

export function conflict(
  message = 'The request conflicts with the current state of the resource.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.CONFLICT, message, options);
}

/** Inventory could not be claimed. Thrown by inventory/checkout, never by the client's word. */
export function outOfStock(
  message = 'Not enough stock to complete this request.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.OUT_OF_STOCK, message, options);
}

export function couponInvalid(
  message = 'This coupon cannot be applied.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.COUPON_INVALID, message, options);
}

/** Same idempotency key replayed with a different payload (API_SPEC.md §6, invariant 5). */
export function idempotencyConflict(
  message = 'This request key was already used with a different payload.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.IDEMPOTENCY_CONFLICT, message, options);
}

/** Payment evidence has not arrived yet; the browser redirect is not proof (invariant 4). */
export function paymentPending(
  message = 'Payment is still being confirmed.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.PAYMENT_PENDING, message, options);
}

export function rateLimited(
  message = 'Too many attempts. Try again later.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.RATE_LIMITED, message, options);
}

/**
 * Only for a failure the caller cannot act on. Attach `cause` so the error middleware
 * logs the real reason server-side while the client gets this generic message.
 */
export function internalError(
  message = 'The request could not be processed.',
  options?: ErrorOptions,
): AppError {
  return new AppError(ErrorCode.INTERNAL_ERROR, message, options);
}
