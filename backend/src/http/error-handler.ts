import type { ErrorRequestHandler, RequestHandler } from 'express';
import { ZodError } from 'zod';

import { isProduction } from '../config/env.js';
import { logger } from '../lib/logger.js';
import { PrismaErrorCode, isPrismaKnownError } from '../lib/prisma-errors.js';
import { AppError, ErrorCode, conflict, notFound } from './errors.js';
import { requestIdOf } from './request-context.js';
import { appErrorFromZod } from './validation.js';

export const notFoundHandler: RequestHandler = (_req, res) => {
  res.status(404).json({
    error: {
      code: ErrorCode.NOT_FOUND,
      message: 'The requested resource does not exist.',
      requestId: requestIdOf(res),
    },
  });
};

/**
 * Last-resort normalisation for errors that reached the middleware without being turned
 * into an `AppError` first. Returns `undefined` when the error has no safe mapping — the
 * caller then logs it in full and answers with a generic 500.
 *
 * Messages here stay generic on purpose: a Prisma error names tables, columns and
 * constraints, and none of that belongs in a response body.
 */
export function asAppError(error: unknown): AppError | undefined {
  if (error instanceof AppError) {
    return error;
  }

  // A schema parsed outside `parseOrThrow` still answers with the documented envelope
  // rather than a 500.
  if (error instanceof ZodError) {
    return appErrorFromZod(error);
  }

  if (isPrismaKnownError(error, PrismaErrorCode.UNIQUE_VIOLATION)) {
    return conflict('That record already exists.', { cause: error });
  }

  if (isPrismaKnownError(error, PrismaErrorCode.RECORD_NOT_FOUND)) {
    return notFound(undefined, { cause: error });
  }

  return undefined;
}

/**
 * The single place a thrown error becomes an HTTP body. Unknown errors are logged in full
 * server-side and answered with a generic message (API_SPEC.md §1).
 */
export const errorHandler: ErrorRequestHandler = (err, req, res, _next) => {
  const requestId = requestIdOf(res);
  const appError = asAppError(err);

  if (appError) {
    // A 5xx is ours to fix, so it is logged with its cause even though it is typed;
    // 4xx stays at debug level so a noisy client cannot flood the error stream.
    logger[appError.status >= 500 ? 'error' : 'debug'](
      { err: appError, code: appError.code, requestId, path: req.path },
      'Request failed',
    );

    res.status(appError.status).json({
      error: {
        code: appError.code,
        message: appError.message,
        ...(appError.details ? { details: appError.details } : {}),
        requestId,
      },
    });
    return;
  }

  logger.error({ err, requestId, path: req.path }, 'Unhandled error while serving request');

  res.status(500).json({
    error: {
      code: ErrorCode.INTERNAL_ERROR,
      message: 'The request could not be processed.',
      ...(isProduction ? {} : { debug: err instanceof Error ? err.message : String(err) }),
      requestId,
    },
  });
};
