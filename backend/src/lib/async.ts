import { logger } from './logger.js';

/**
 * Shared async plumbing for calls that can fail in expected ways: payment providers,
 * email, object storage, webhook delivery (architecture.md §11, CLAUDE.md invariants
 * 6 and 9).
 *
 * The point of these helpers is that a service should not need a try/catch to express
 * "this may fail and I have a plan for that". `attempt` turns the failure into a value,
 * `withTimeout` bounds a hanging provider, and `withRetry` does bounded exponential
 * backoff with jitter instead of each caller inventing its own loop.
 */
export type Result<T, E = Error> =
  { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

/** `throw` can carry anything; normalise it before logging or wrapping. */
export function toError(value: unknown): Error {
  if (value instanceof Error) {
    return value;
  }

  return new Error(typeof value === 'string' ? value : JSON.stringify(value), { cause: value });
}

/**
 * Runs `fn` and reports the outcome as a value.
 *
 * Use it where failure is part of the flow (a provider refusing a charge, a reconciliation
 * read). Do not use it to silence an error you have no answer for — let that one reach the
 * error middleware.
 */
export async function attempt<T>(fn: () => Promise<T> | T): Promise<Result<T>> {
  try {
    return { ok: true, value: await fn() };
  } catch (error) {
    return { ok: false, error: toError(error) };
  }
}

export class TimeoutError extends Error {
  readonly timeoutMs: number;

  constructor(label: string, timeoutMs: number) {
    super(`${label} timed out after ${timeoutMs}ms`);
    this.name = 'TimeoutError';
    this.timeoutMs = timeoutMs;
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms).unref();
  });
}

/**
 * Bounds a provider call. The callback receives an `AbortSignal` so a `fetch`-based
 * adapter actually stops work instead of leaking a request that outlives the response —
 * a provider timeout must leave a recoverable state, not a hung handler.
 */
export async function withTimeout<T>(
  label: string,
  timeoutMs: number,
  fn: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;

  const expiry = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new TimeoutError(label, timeoutMs));
    }, timeoutMs);
    timer.unref();
  });

  try {
    return await Promise.race([fn(controller.signal), expiry]);
  } finally {
    if (timer) {
      clearTimeout(timer);
    }
  }
}

export interface BackoffOptions {
  /** First delay; each attempt doubles it up to `maxDelayMs`. */
  readonly baseDelayMs?: number;
  readonly maxDelayMs?: number;
  /** Full jitter by default, so retries from many workers do not align (architecture.md §11). */
  readonly jitter?: boolean;
}

const DEFAULT_BACKOFF = { baseDelayMs: 100, maxDelayMs: 10_000, jitter: true } as const;

/** Delay before retry number `attempt` (1-based). Exported so jobs can persist a next-run time. */
export function backoffDelayMs(attempt: number, options: BackoffOptions = {}): number {
  const base = options.baseDelayMs ?? DEFAULT_BACKOFF.baseDelayMs;
  const max = options.maxDelayMs ?? DEFAULT_BACKOFF.maxDelayMs;
  const jitter = options.jitter ?? DEFAULT_BACKOFF.jitter;

  const exponential = Math.min(max, base * 2 ** Math.max(0, attempt - 1));

  return jitter ? Math.round(Math.random() * exponential) : exponential;
}

export interface RetryOptions extends BackoffOptions {
  /** Total tries, not extra tries: `attempts: 3` means one call plus two retries. */
  readonly attempts?: number;
  /** Default: retry nothing. Decide per call site which failures are safe to repeat. */
  readonly isRetryable?: (error: Error, attempt: number) => boolean;
  readonly label?: string;
  readonly onRetry?: (error: Error, attempt: number, delayMs: number) => void;
}

/**
 * Bounded retry with exponential backoff and jitter.
 *
 * Only wrap work that is safe to run twice: a retried mutation must be idempotent
 * (CLAUDE.md engineering rules), which usually means a provider idempotency key or a
 * conditional write. `isRetryable` is deliberately opt-in so nothing is retried by accident.
 */
export async function withRetry<T>(
  fn: (attempt: number) => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3);
  const label = options.label ?? 'operation';
  const isRetryable = options.isRetryable ?? (() => false);

  let lastError: Error | undefined;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (caught) {
      const error = toError(caught);
      lastError = error;

      if (attempt === attempts || !isRetryable(error, attempt)) {
        throw error;
      }

      const delayMs = backoffDelayMs(attempt, options);
      if (options.onRetry) {
        options.onRetry(error, attempt, delayMs);
      } else {
        logger.warn({ err: error, attempt, attempts, delayMs, label }, 'Retrying after failure');
      }

      await sleep(delayMs);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError ?? new Error(`${label} failed without an error`);
}

/**
 * Runs best-effort work that must never fail the caller, and logs what went wrong.
 *
 * For non-critical side effects only (a cache warm, a metric). Receipts, stock movements
 * and anything a customer can notice belong in the durable outbox — in-memory
 * fire-and-forget does not survive a serverless instance going away.
 */
export async function runSafely(label: string, fn: () => Promise<unknown>): Promise<void> {
  const outcome = await attempt(fn);

  if (!outcome.ok) {
    logger.error({ err: outcome.error, label }, 'Best-effort task failed');
  }
}
