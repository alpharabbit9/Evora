import { describe, expect, it, vi } from 'vitest';

import {
  TimeoutError,
  attempt,
  backoffDelayMs,
  runSafely,
  toError,
  withRetry,
  withTimeout,
} from '../src/lib/async.js';

/** Keeps the retry tests fast without changing the behaviour under test. */
const fastBackoff = { baseDelayMs: 1, maxDelayMs: 2, jitter: false } as const;

describe('toError', () => {
  it('passes an Error through and wraps anything else', () => {
    const original = new Error('boom');
    expect(toError(original)).toBe(original);

    const fromString = toError('provider said no');
    expect(fromString).toBeInstanceOf(Error);
    expect(fromString.message).toBe('provider said no');

    const fromObject = toError({ code: 'card_declined' });
    expect(fromObject.message).toContain('card_declined');
    expect(fromObject.cause).toEqual({ code: 'card_declined' });
  });
});

describe('attempt', () => {
  it('reports success as a value', async () => {
    const result = await attempt(() => 'charged');

    expect(result).toEqual({ ok: true, value: 'charged' });
  });

  it('reports failure as a value instead of throwing', async () => {
    const result = await attempt(async () => {
      await Promise.resolve();
      throw new Error('provider unreachable');
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.message).toBe('provider unreachable');
    }
  });
});

describe('withTimeout', () => {
  it('returns the value when the call finishes in time', async () => {
    await expect(withTimeout('fast-call', 1_000, () => Promise.resolve('ok'))).resolves.toBe('ok');
  });

  it('rejects with a TimeoutError and aborts the signal when it does not', async () => {
    let aborted = false;

    const pending = withTimeout('slow-provider', 10, (signal) => {
      signal.addEventListener('abort', () => {
        aborted = true;
      });
      return new Promise<string>(() => {
        // never settles: stands in for a provider that stopped answering
      });
    });

    await expect(pending).rejects.toBeInstanceOf(TimeoutError);
    expect(aborted).toBe(true);
  });
});

describe('backoffDelayMs', () => {
  it('doubles up to the ceiling', () => {
    const options = { baseDelayMs: 100, maxDelayMs: 400, jitter: false };

    expect(backoffDelayMs(1, options)).toBe(100);
    expect(backoffDelayMs(2, options)).toBe(200);
    expect(backoffDelayMs(3, options)).toBe(400);
    expect(backoffDelayMs(9, options)).toBe(400);
  });

  it('stays inside the exponential bound when jittered', () => {
    for (let attemptNumber = 1; attemptNumber <= 5; attemptNumber += 1) {
      const delay = backoffDelayMs(attemptNumber, { baseDelayMs: 50, maxDelayMs: 1_000 });
      const ceiling = Math.min(1_000, 50 * 2 ** (attemptNumber - 1));

      expect(delay).toBeGreaterThanOrEqual(0);
      expect(delay).toBeLessThanOrEqual(ceiling);
    }
  });
});

describe('withRetry', () => {
  it('retries a failure the caller marked retryable and returns the later success', async () => {
    const calls: number[] = [];
    const onRetry = vi.fn();

    const value = await withRetry(
      async (attemptNumber) => {
        calls.push(attemptNumber);
        await Promise.resolve();
        if (attemptNumber < 3) {
          throw new Error('503 from provider');
        }
        return 'settled';
      },
      { attempts: 3, isRetryable: () => true, onRetry, ...fastBackoff },
    );

    expect(value).toBe('settled');
    expect(calls).toEqual([1, 2, 3]);
    expect(onRetry).toHaveBeenCalledTimes(2);
  });

  it('does not retry by default, so nothing is replayed by accident', async () => {
    const fn = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('card declined');
    });

    await expect(withRetry(fn, { attempts: 5, ...fastBackoff })).rejects.toThrow('card declined');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('respects a predicate that refuses a particular failure', async () => {
    const fn = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('IDEMPOTENCY_CONFLICT');
    });

    await expect(
      withRetry(fn, {
        attempts: 4,
        isRetryable: (error) => !error.message.includes('IDEMPOTENCY_CONFLICT'),
        ...fastBackoff,
      }),
    ).rejects.toThrow('IDEMPOTENCY_CONFLICT');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('gives up after the configured number of attempts and rethrows the last error', async () => {
    const fn = vi.fn(async () => {
      await Promise.resolve();
      throw new Error('still failing');
    });

    await expect(
      withRetry(fn, { attempts: 3, isRetryable: () => true, onRetry: () => {}, ...fastBackoff }),
    ).rejects.toThrow('still failing');
    expect(fn).toHaveBeenCalledTimes(3);
  });
});

describe('runSafely', () => {
  it('swallows the failure of best-effort work', async () => {
    await expect(
      runSafely('cache-warm', async () => {
        await Promise.resolve();
        throw new Error('cache unavailable');
      }),
    ).resolves.toBeUndefined();
  });
});
