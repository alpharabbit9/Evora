import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import { emailTransport } from '../notifications/transport.js';
import { ensureRecurringJobs } from './outbox.store.js';
import { type BatchSummary, runDueJobs } from './worker.js';

/**
 * Drains the outbox in bounded passes, for hosts that cannot keep a worker process running
 * (ADR 0028). Three callers share it:
 *
 *  - `node dist/worker.js --once`, for a host that can only schedule commands;
 *  - the scheduled `GET /api/v1/internal/outbox/drain` (Vercel Cron, or any scheduler that holds
 *    the secret);
 *  - the API itself after a successful write on Vercel, so a password-reset email or an order
 *    receipt leaves within seconds instead of waiting for the next schedule.
 *
 * Nothing here weakens the outbox: rows are written in the same transaction as the change they
 * describe, so a drain cut short (a function frozen or timed out mid-batch) only delays a job.
 * Its lease runs out and the next drain, from any caller, takes it over (ADR 0021).
 */
export interface DrainSummary {
  readonly batches: number;
  readonly claimed: number;
  readonly sent: number;
  readonly skipped: number;
  readonly retrying: number;
  readonly dead: number;
  readonly lost: number;
  /** False when it stopped on its batch or time budget with jobs possibly still due. */
  readonly drained: boolean;
}

export interface DrainOptions {
  /** One claim-and-run pass. Defaults to the real worker with the configured email transport. */
  readonly runBatch?: () => Promise<BatchSummary>;
  /** Makes sure the recurring rows exist before the first pass. `false` skips it. */
  readonly ensureRecurring?: (() => Promise<void>) | false;
  /** A pass that claims fewer than this found the queue empty. */
  readonly batchSize?: number;
  readonly maxBatches?: number;
  /**
   * No new pass starts once this many milliseconds have gone by. A pass already started runs to
   * its end, each job inside its own handler timeout, so set this well inside the host's limit.
   */
  readonly budgetMs?: number;
  readonly now?: () => number;
}

const EMPTY: Omit<DrainSummary, 'drained'> = {
  batches: 0,
  claimed: 0,
  sent: 0,
  skipped: 0,
  retrying: 0,
  dead: 0,
  lost: 0,
};

export async function drainDueJobs(options: DrainOptions = {}): Promise<DrainSummary> {
  const runBatch = options.runBatch ?? (() => runDueJobs({ transport: emailTransport() }));
  const ensure = options.ensureRecurring ?? (() => ensureRecurringJobs());
  const batchSize = options.batchSize ?? env.WORKER_BATCH_SIZE;
  const maxBatches = options.maxBatches ?? 50;
  const now = options.now ?? Date.now;
  const deadline = options.budgetMs === undefined ? Infinity : now() + options.budgetMs;

  if (ensure) await ensure();

  let total = { ...EMPTY };

  while (total.batches < maxBatches) {
    if (now() >= deadline) return { ...total, drained: false };

    const batch = await runBatch();
    total = {
      batches: total.batches + 1,
      claimed: total.claimed + batch.claimed,
      sent: total.sent + batch.sent,
      skipped: total.skipped + batch.skipped,
      retrying: total.retrying + batch.retrying,
      dead: total.dead + batch.dead,
      lost: total.lost + batch.lost,
    };

    if (batch.claimed < batchSize) return { ...total, drained: true };
  }

  return { ...total, drained: false };
}

let recurringEnsured = false;

/** `ensureRecurringJobs` once per process: three upserts are not worth repeating on every write. */
export async function ensureRecurringJobsOnce(): Promise<void> {
  if (recurringEnsured) return;
  await ensureRecurringJobs();
  recurringEnsured = true;
}

/**
 * Runs `drain` after a write, at most one at a time per process. A write that finishes while a
 * drain is running asks for one more pass instead of starting a second, because its job may have
 * been committed after the running pass made its claim. Passes are bounded so steady traffic
 * cannot keep one function invocation alive; whatever is left waits for the next write or the
 * schedule.
 */
export function createDrainCoalescer(
  drain: () => Promise<unknown>,
  options: { readonly maxPasses?: number } = {},
): () => Promise<void> {
  const maxPasses = options.maxPasses ?? 3;
  let running: Promise<void> | undefined;
  let again = false;

  return () => {
    if (running) {
      again = true;
      return running;
    }

    const run = async (): Promise<void> => {
      try {
        let passes = 0;
        do {
          again = false;
          passes += 1;
          await drain();
        } while (again && passes < maxPasses);
      } catch (error) {
        // The rows are still in the outbox; the next drain retries them.
        logger.error({ err: error }, 'Outbox drain after a write failed');
      }
    };

    // `.finally` settles on a later tick, after `running` is assigned, even if `drain` throws
    // synchronously.
    const current = run().finally(() => {
      running = undefined;
    });
    running = current;
    return current;
  };
}
