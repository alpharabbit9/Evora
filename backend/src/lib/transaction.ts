import { Prisma } from '@prisma/client';

import { backoffDelayMs, sleep, toError } from './async.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { isWriteConflict } from './prisma-errors.js';

/**
 * The shared transaction boundary for critical writes (checkout, inventory claim, webhook
 * processing, refunds).
 *
 * Two rules it exists to enforce, from CLAUDE.md and architecture.md §7:
 *
 *  - Transactions stay short and bounded. `timeoutMs` is low on purpose: a transaction
 *    that cannot finish inside it is holding locks that block other checkouts.
 *  - No payment, email or other network call inside the callback. Commit first, then call
 *    the provider, then record the result in a second short transaction.
 *
 * A write conflict (`P2034`) is retried, because PostgreSQL has already rolled the whole
 * transaction back — nothing was committed, so running it again is safe. Nothing else is
 * retried: a unique violation or a failed conditional update is a domain answer, and the
 * caller must decide what it means.
 */
export type TransactionClient = Prisma.TransactionClient;

export const TRANSACTION_DEFAULTS = {
  /** How long to wait for a pool connection before giving up. */
  maxWaitMs: 2_000,
  /** How long the transaction may hold its locks. */
  timeoutMs: 5_000,
  /** Total tries on a write conflict, including the first. */
  attempts: 3,
} as const;

export interface TransactionOptions {
  /** Shows up in retry/slow-transaction logs; name the use case, e.g. 'checkout.createOrder'. */
  readonly label?: string;
  readonly isolationLevel?: Prisma.TransactionIsolationLevel;
  readonly maxWaitMs?: number;
  readonly timeoutMs?: number;
  readonly attempts?: number;
}

export async function withTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: TransactionOptions = {},
): Promise<T> {
  const label = options.label ?? 'transaction';
  const attempts = Math.max(1, options.attempts ?? TRANSACTION_DEFAULTS.attempts);

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await prisma.$transaction(fn, {
        maxWait: options.maxWaitMs ?? TRANSACTION_DEFAULTS.maxWaitMs,
        timeout: options.timeoutMs ?? TRANSACTION_DEFAULTS.timeoutMs,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      });
    } catch (caught) {
      const error = toError(caught);

      if (attempt === attempts || !isWriteConflict(caught)) {
        throw error;
      }

      const delayMs = backoffDelayMs(attempt, { baseDelayMs: 25, maxDelayMs: 250 });
      logger.warn(
        { err: error, attempt, attempts, delayMs, label },
        'Retrying transaction after write conflict',
      );
      await sleep(delayMs);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw new Error(`${label} exhausted its transaction attempts`);
}

/**
 * Serializable isolation for invariants a constraint cannot express — "a coupon's usage
 * limit across concurrent redemptions", for example. Conflicts surface as `P2034` and are
 * retried by `withTransaction`. Prefer a conditional atomic write where one works
 * (architecture.md §8); it does not need this.
 */
export async function withSerializableTransaction<T>(
  fn: (tx: TransactionClient) => Promise<T>,
  options: Omit<TransactionOptions, 'isolationLevel'> = {},
): Promise<T> {
  return withTransaction(fn, {
    ...options,
    isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
  });
}
