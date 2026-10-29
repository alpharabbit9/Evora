import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';

import { AppError } from '../src/http/errors.js';
import { asAppError } from '../src/http/error-handler.js';
import {
  PrismaErrorCode,
  isForeignKeyViolation,
  isPrismaKnownError,
  isRecordNotFound,
  isUniqueViolation,
  isWriteConflict,
  uniqueViolationFields,
} from '../src/lib/prisma-errors.js';

function prismaError(code: string, meta?: Record<string, unknown>): Error {
  return new Prisma.PrismaClientKnownRequestError(`simulated ${code}`, {
    code,
    clientVersion: 'test',
    ...(meta ? { meta } : {}),
  });
}

describe('prisma error predicates', () => {
  it('recognises a unique violation and the columns it names', () => {
    const error = prismaError(PrismaErrorCode.UNIQUE_VIOLATION, { target: ['users_email_key'] });

    expect(isPrismaKnownError(error)).toBe(true);
    expect(isUniqueViolation(error)).toBe(true);
    expect(uniqueViolationFields(error)).toEqual(['users_email_key']);
    expect(isUniqueViolation(error, 'users_email_key')).toBe(true);
    expect(isUniqueViolation(error, 'sku')).toBe(false);
  });

  it('accepts a single-string target as well as an array', () => {
    const error = prismaError(PrismaErrorCode.UNIQUE_VIOLATION, { target: 'sku' });

    expect(uniqueViolationFields(error)).toEqual(['sku']);
  });

  it('separates the retryable write conflict from the domain failures', () => {
    expect(isWriteConflict(prismaError(PrismaErrorCode.WRITE_CONFLICT))).toBe(true);
    expect(isWriteConflict(prismaError(PrismaErrorCode.UNIQUE_VIOLATION))).toBe(false);
    expect(isRecordNotFound(prismaError(PrismaErrorCode.RECORD_NOT_FOUND))).toBe(true);
    expect(isForeignKeyViolation(prismaError(PrismaErrorCode.FOREIGN_KEY_VIOLATION))).toBe(true);
  });

  it('is safe to call with anything that was thrown', () => {
    expect(isUniqueViolation(new Error('nope'))).toBe(false);
    expect(isUniqueViolation(undefined)).toBe(false);
    expect(isUniqueViolation('P2002')).toBe(false);
    expect(uniqueViolationFields(null)).toEqual([]);
  });
});

describe('asAppError', () => {
  it('maps the two safe Prisma failures and keeps the database wording out of the message', () => {
    const duplicate = asAppError(
      prismaError(PrismaErrorCode.UNIQUE_VIOLATION, { target: ['users_email_key'] }),
    );

    expect(duplicate).toBeInstanceOf(AppError);
    expect(duplicate?.code).toBe('CONFLICT');
    expect(duplicate?.status).toBe(409);
    expect(duplicate?.message).not.toContain('users_email_key');

    const missing = asAppError(prismaError(PrismaErrorCode.RECORD_NOT_FOUND));
    expect(missing?.code).toBe('NOT_FOUND');
    expect(missing?.status).toBe(404);
  });

  it('leaves an unmapped failure for the generic 500 path', () => {
    expect(asAppError(prismaError(PrismaErrorCode.TRANSACTION_TIMEOUT))).toBeUndefined();
    expect(asAppError(new Error('something else'))).toBeUndefined();
  });
});
