import type { OutboxEventType } from '@prisma/client';

import { env } from '../../config/env.js';
import { sleep, toError, withTimeout } from '../../lib/async.js';
import { logger } from '../../lib/logger.js';
import { RETENTION_INTERVAL_MS, assistantHandlers } from '../assistant/assistant-jobs.js';
import { notificationHandlers } from '../notifications/notification-jobs.js';
import { EmailDeliveryError, type EmailTransport } from '../notifications/transport.js';
import { reconcilePayments } from '../payments/payments.service.js';
import { reconcileRefunds } from '../refunds/refunds.service.js';
import { PermanentJobError, handlerTimeoutMs } from './job-policy.js';
import type { JobHandler } from './job-types.js';
import {
  type ClaimedJob,
  claimDueJobs,
  completeJob,
  ensureRecurringJobs,
  failJob,
} from './outbox.store.js';

/**
 * The outbox worker (ADR 0021, implementation-plan.md M9). It claims due rows, runs each one's
 * handler outside any transaction, and records the outcome:
 *
 *  - success: SENT (a recurring job is rescheduled instead);
 *  - a failure a retry may fix: FAILED, retried after bounded exponential backoff with jitter;
 *  - a permanent failure, or the last allowed try: DEAD, for a person to look at and retry.
 *
 * A failure here never reaches the order, payment or account the job is about: those committed
 * before the row was written (commerce invariant 9).
 */

/** The payment and refund sweep, which `npm run payments:reconcile` used to be the only way to run. */
const reconcile: JobHandler = async () => {
  const payments = await reconcilePayments();
  const refunds = await reconcileRefunds();
  logger.info({ payments, refunds }, 'Payment reconciliation finished');
  return undefined;
};

export const DEFAULT_HANDLERS: Readonly<Record<OutboxEventType, JobHandler>> = {
  ...notificationHandlers,
  ...assistantHandlers,
  PAYMENT_RECONCILIATION: reconcile,
};

/** How long a recurring job waits between runs. One-off jobs ignore it. */
export function recurringIntervalFor(type: OutboxEventType): number {
  switch (type) {
    case 'ASSISTANT_INDEX_SWEEP':
      return env.ASSISTANT_INDEX_INTERVAL_MS;
    case 'ASSISTANT_RETENTION':
      return RETENTION_INTERVAL_MS;
    default:
      return env.RECONCILE_INTERVAL_MS;
  }
}

export interface WorkerDeps {
  readonly transport: EmailTransport;
  readonly handlers?: Readonly<Record<OutboxEventType, JobHandler>>;
  readonly now?: () => Date;
  readonly random?: () => number;
  readonly recurringIntervalMs?: number;
}

export interface BatchSummary {
  readonly claimed: number;
  readonly sent: number;
  readonly skipped: number;
  readonly retrying: number;
  readonly dead: number;
  /** Outcomes not recorded because another worker had taken the row over. */
  readonly lost: number;
}

function isPermanent(error: Error): boolean {
  return (
    error instanceof PermanentJobError || (error instanceof EmailDeliveryError && error.permanent)
  );
}

type Outcome = 'sent' | 'skipped' | 'retrying' | 'dead' | 'lost';

async function runOne(job: ClaimedJob, deps: WorkerDeps): Promise<Outcome> {
  const handlers = deps.handlers ?? DEFAULT_HANDLERS;
  const now = deps.now ?? (() => new Date());
  const recurringIntervalMs = deps.recurringIntervalMs ?? recurringIntervalFor(job.eventType);
  const log = { jobId: job.id, eventType: job.eventType, attempt: job.attemptCount };

  try {
    const result = await withTimeout(
      `outbox job ${job.eventType}`,
      handlerTimeoutMs(job.eventType),
      () => handlers[job.eventType](job, { transport: deps.transport, now: now() }),
    );
    const skipped = result?.skipped;
    const recorded = await completeJob(job, {
      now: now(),
      recurringIntervalMs,
      ...(skipped ? { note: `Not sent: ${skipped}` } : {}),
    });

    if (!recorded) {
      logger.warn(log, 'Outbox job finished after another worker took it over');
      return 'lost';
    }

    logger.info({ ...log, ...(skipped ? { skipped } : {}) }, 'Outbox job done');
    return skipped ? 'skipped' : 'sent';
  } catch (caught) {
    const error = toError(caught);
    const failure = await failJob(job, error, {
      now: now(),
      permanent: isPermanent(error),
      recurringIntervalMs,
      ...(deps.random ? { random: deps.random } : {}),
    });

    if (!failure.recorded) {
      logger.warn(log, 'Outbox job failed after another worker took it over');
      return 'lost';
    }

    // The error object is not logged whole: a relay's message can quote the recipient's address.
    const detail = { ...log, errorName: error.name, nextAttemptAt: failure.nextAttemptAt };
    if (failure.status === 'DEAD') {
      logger.error(detail, 'Outbox job is dead; it needs a person');
      return 'dead';
    }

    logger.warn(detail, 'Outbox job failed; it will be retried');
    return 'retrying';
  }
}

/**
 * One poll: claim up to `limit` due rows and run them side by side, so one slow send cannot hold
 * the rest of the batch past their lease.
 */
export async function runDueJobs(
  deps: WorkerDeps,
  options: { readonly limit?: number } = {},
): Promise<BatchSummary> {
  const now = deps.now ?? (() => new Date());
  const jobs = await claimDueJobs({ now: now(), limit: options.limit ?? env.WORKER_BATCH_SIZE });
  const outcomes = await Promise.all(jobs.map((job) => runOne(job, deps)));
  const count = (outcome: Outcome) => outcomes.filter((value) => value === outcome).length;

  return {
    claimed: jobs.length,
    sent: count('sent'),
    skipped: count('skipped'),
    retrying: count('retrying'),
    dead: count('dead'),
    lost: count('lost'),
  };
}

export interface RunningWorker {
  /** Stops claiming, waits for the batch in hand, then resolves. */
  stop(): Promise<void>;
}

/**
 * Polls until stopped. A full batch means there is probably more waiting, so it polls again at
 * once; otherwise it waits `pollIntervalMs`. A failing poll (the database is down) is logged and
 * retried on the next tick rather than ending the process.
 */
export function startWorker(
  deps: WorkerDeps,
  options: { readonly pollIntervalMs?: number; readonly batchSize?: number } = {},
): RunningWorker {
  const pollIntervalMs = options.pollIntervalMs ?? env.WORKER_POLL_INTERVAL_MS;
  const batchSize = options.batchSize ?? env.WORKER_BATCH_SIZE;
  let running = true;
  let wake: (() => void) | undefined;

  let ensured = false;

  const loop = (async () => {
    while (running) {
      let full = false;

      try {
        if (!ensured) {
          await ensureRecurringJobs();
          ensured = true;
        }

        const summary = await runDueJobs(deps, { limit: batchSize });
        full = summary.claimed === batchSize;
        if (summary.claimed > 0) logger.debug(summary, 'Outbox batch finished');
      } catch (error) {
        logger.error({ err: error }, 'Outbox poll failed; trying again shortly');
      }

      if (running && !full) {
        await Promise.race([
          sleep(pollIntervalMs),
          new Promise<void>((resolve) => {
            wake = resolve;
          }),
        ]);
      }
    }
  })();

  return {
    async stop() {
      running = false;
      wake?.();
      await loop;
    },
  };
}
