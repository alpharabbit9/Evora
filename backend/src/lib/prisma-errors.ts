import { Prisma } from '@prisma/client';

/**
 * Predicates for the Prisma failures that carry domain meaning, so services can turn a
 * constraint violation into the right `AppError` instead of each one re-deriving
 * `error instanceof Prisma.PrismaClientKnownRequestError && error.code === '...'`.
 *
 * Database constraints are the final guardrail (architecture.md §5): a unique index
 * firing is an expected outcome of a concurrent request, not a server fault.
 */
export const PrismaErrorCode = {
  UNIQUE_VIOLATION: 'P2002',
  FOREIGN_KEY_VIOLATION: 'P2003',
  CONSTRAINT_VIOLATION: 'P2004',
  RECORD_NOT_FOUND: 'P2025',
  /** Write conflict or deadlock — the one class of failure that is safe to retry. */
  WRITE_CONFLICT: 'P2034',
  TRANSACTION_TIMEOUT: 'P2028',
} as const;

export function isPrismaKnownError(
  error: unknown,
  code?: string,
): error is Prisma.PrismaClientKnownRequestError {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError &&
    (code === undefined || error.code === code)
  );
}

/** Fields named by a `P2002`. Useful for pointing a validation detail at the right input. */
export function uniqueViolationFields(error: unknown): string[] {
  if (!isPrismaKnownError(error, PrismaErrorCode.UNIQUE_VIOLATION)) {
    return [];
  }

  const target = error.meta?.['target'];

  if (Array.isArray(target)) {
    return target.filter((entry): entry is string => typeof entry === 'string');
  }

  return typeof target === 'string' ? [target] : [];
}

/** `field` narrows the check to one column, e.g. `isUniqueViolation(error, 'email')`. */
export function isUniqueViolation(error: unknown, field?: string): boolean {
  if (!isPrismaKnownError(error, PrismaErrorCode.UNIQUE_VIOLATION)) {
    return false;
  }

  return field === undefined || uniqueViolationFields(error).includes(field);
}

export function isForeignKeyViolation(error: unknown): boolean {
  return isPrismaKnownError(error, PrismaErrorCode.FOREIGN_KEY_VIOLATION);
}

/**
 * A conditional write matched no row — which, for the inventory update in
 * architecture.md §8, means the stock could not be claimed rather than "server broken".
 */
export function isRecordNotFound(error: unknown): boolean {
  return isPrismaKnownError(error, PrismaErrorCode.RECORD_NOT_FOUND);
}

/** Safe to retry: PostgreSQL rolled the transaction back before anything was committed. */
export function isWriteConflict(error: unknown): boolean {
  return isPrismaKnownError(error, PrismaErrorCode.WRITE_CONFLICT);
}
