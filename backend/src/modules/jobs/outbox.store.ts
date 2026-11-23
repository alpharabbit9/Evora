import { randomUUID } from 'node:crypto';

import type { OutboxEventType, Prisma } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import {
  MAX_ATTEMPTS,
  ASSISTANT_INDEX_DEDUPE_KEY,
  ASSISTANT_RETENTION_DEDUPE_KEY,
  RECONCILIATION_DEDUPE_KEY,
  RECURRING_TYPES,
  SCRUB_ON_FINISH,
  decideFailure,
  leaseMs,
  safeErrorMessage,
  scrubbedPayload,
} from './job-policy.js';

/**
 * The worker's reads and writes on `outbox_events` (ADR 0021). Three short transactions per job,
 * none of which waits on the network: claim, then (after the send) record the outcome.
 *
 * Claiming uses `FOR UPDATE SKIP LOCKED`, so any number of workers can poll the same table and
 * each due row goes to exactly one of them. A claim sets `claim_token`, and the outcome is written
 * only while that token still matches: a worker whose lease ran out (it hung, or the machine
 * paused) finds its update matches nothing, and cannot overwrite the worker that took over.
 */
export interface ClaimedJob {
  readonly id: string;
  readonly eventType: OutboxEventType;
  readonly dedupeKey: string;
  readonly payload: Prisma.JsonValue;
  /** Including this try. */
  readonly attemptCount: number;
  readonly createdAt: Date;
  readonly claimToken: string;
}

const CLAIMED_SELECT = {
  id: true,
  eventType: true,
  dedupeKey: true,
  payload: true,
  attemptCount: true,
  createdAt: true,
} as const;

/**
 * Due rows: waiting for a first try or a retry, or claimed by a worker whose lease has run out.
 * The time is compared in UTC whatever the session's time zone, because Prisma stores
 * `timestamp(3)` columns as UTC.
 */
export async function claimDueJobs(options: {
  readonly now: Date;
  readonly limit: number;
}): Promise<ClaimedJob[]> {
  return withTransaction(
    async (tx) => {
      const due = await tx.$queryRaw<
        {
          id: string;
          status: string;
          event_type: OutboxEventType;
          attempt_count: number;
          payload: Prisma.JsonValue;
        }[]
      >`
        SELECT id, status::text AS status, event_type::text AS event_type, attempt_count, payload
        FROM outbox_events
        WHERE status IN ('PENDING', 'FAILED', 'PROCESSING')
          AND next_attempt_at <= (${options.now.toISOString()}::timestamptz AT TIME ZONE 'UTC')
        ORDER BY next_attempt_at, created_at
        LIMIT ${options.limit}
        FOR UPDATE SKIP LOCKED
      `;

      const claimed: ClaimedJob[] = [];

      for (const row of due) {
        const type = { eventType: row.event_type, payload: row.payload };

        // A worker died mid-try on its last allowed attempt, possibly more than once: the row may
        // be what kills it. It goes to a person instead of round again.
        if (
          row.status === 'PROCESSING' &&
          row.attempt_count >= MAX_ATTEMPTS &&
          !RECURRING_TYPES.has(type.eventType)
        ) {
          await tx.outboxEvent.update({
            where: { id: row.id },
            data: {
              status: 'DEAD',
              claimToken: null,
              nextAttemptAt: options.now,
              lastError: `Gave up after ${String(row.attempt_count)} tries: the worker stopped during the last one`,
              ...(SCRUB_ON_FINISH.has(type.eventType)
                ? { payload: scrubbedPayload(type.payload) }
                : {}),
            },
          });
          logger.error({ jobId: row.id, eventType: type.eventType }, 'Outbox job is dead');
          continue;
        }

        if (row.status === 'PROCESSING') {
          logger.warn(
            { jobId: row.id, eventType: type.eventType },
            'Took over an outbox job whose worker lease ran out',
          );
        }

        const claimToken = randomUUID();
        const job = await tx.outboxEvent.update({
          where: { id: row.id },
          data: {
            status: 'PROCESSING',
            claimToken,
            attemptCount: { increment: 1 },
            nextAttemptAt: new Date(options.now.getTime() + leaseMs(type.eventType)),
          },
          select: CLAIMED_SELECT,
        });

        claimed.push({ ...job, claimToken });
      }

      return claimed;
    },
    { label: 'jobs.claim' },
  );
}

/** Done. A recurring job is put back in the queue for its next run instead. */
export async function completeJob(
  job: ClaimedJob,
  options: { readonly now: Date; readonly note?: string; readonly recurringIntervalMs: number },
): Promise<boolean> {
  const data: Prisma.OutboxEventUpdateManyMutationInput = RECURRING_TYPES.has(job.eventType)
    ? {
        status: 'PENDING',
        claimToken: null,
        attemptCount: 0,
        lastError: null,
        processedAt: options.now,
        nextAttemptAt: new Date(options.now.getTime() + options.recurringIntervalMs),
      }
    : {
        status: 'SENT',
        claimToken: null,
        processedAt: options.now,
        nextAttemptAt: options.now,
        lastError: options.note ?? null,
        ...(SCRUB_ON_FINISH.has(job.eventType) ? { payload: scrubbedPayload(job.payload) } : {}),
      };

  const { count } = await prisma.outboxEvent.updateMany({
    where: { id: job.id, claimToken: job.claimToken },
    data,
  });

  return count === 1;
}

export interface FailureRecord {
  readonly status: 'FAILED' | 'DEAD';
  readonly nextAttemptAt: Date;
  /** False when another worker had taken the row over; nothing was written. */
  readonly recorded: boolean;
}

export async function failJob(
  job: ClaimedJob,
  error: unknown,
  options: {
    readonly now: Date;
    readonly permanent: boolean;
    readonly recurringIntervalMs: number;
    readonly random?: () => number;
  },
): Promise<FailureRecord> {
  const decision = decideFailure({
    eventType: job.eventType,
    attemptCount: job.attemptCount,
    permanent: options.permanent,
    now: options.now,
    recurringIntervalMs: options.recurringIntervalMs,
    ...(options.random ? { random: options.random } : {}),
  });

  const { count } = await prisma.outboxEvent.updateMany({
    where: { id: job.id, claimToken: job.claimToken },
    data: {
      status: decision.status,
      claimToken: null,
      nextAttemptAt: decision.nextAttemptAt,
      lastError: safeErrorMessage(error),
      ...(decision.status === 'DEAD' && SCRUB_ON_FINISH.has(job.eventType)
        ? { payload: scrubbedPayload(job.payload) }
        : {}),
    },
  });

  return { ...decision, recorded: count === 1 };
}

/**
 * The recurring rows exist exactly once. Safe to call on every worker start: an existing row,
 * with its schedule and history, is left as it is.
 */
export async function ensureRecurringJobs(now: Date = new Date()): Promise<void> {
  const rows = [
    { eventType: 'PAYMENT_RECONCILIATION', dedupeKey: RECONCILIATION_DEDUPE_KEY },
    { eventType: 'ASSISTANT_INDEX_SWEEP', dedupeKey: ASSISTANT_INDEX_DEDUPE_KEY },
    { eventType: 'ASSISTANT_RETENTION', dedupeKey: ASSISTANT_RETENTION_DEDUPE_KEY },
  ] as const;

  for (const row of rows) {
    await prisma.outboxEvent.upsert({
      where: { dedupeKey: row.dedupeKey },
      update: {},
      create: { ...row, payload: {}, nextAttemptAt: now },
    });
  }
}
