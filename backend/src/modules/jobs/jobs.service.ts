import type { OutboxEventType, OutboxStatus, Prisma } from '@prisma/client';

import { conflict, notFound } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';
import {
  type JobSubject,
  MAX_ATTEMPTS,
  RECONCILIATION_DEDUPE_KEY,
  RECURRING_TYPES,
  SCRUB_ON_FINISH,
  isScrubbed,
  jobSubject,
} from './job-policy.js';

/**
 * Failed-job visibility and manual retry (implementation-plan.md M9, ADR 0021), behind
 * `requireAdmin`.
 *
 * Payloads never leave this module: an account email carries a working reset or verification
 * link. A job is described by `subject`, an allow-list of identifiers (`jobSubject`).
 */
export interface JobView {
  readonly id: string;
  readonly eventType: OutboxEventType;
  readonly status: OutboxStatus;
  readonly recurring: boolean;
  readonly attemptCount: number;
  /** Null for a recurring job, which is never given up on. */
  readonly maxAttempts: number | null;
  /** When it runs next, or the claim's expiry while PROCESSING; null once finished. */
  readonly nextAttemptAt: Date | null;
  readonly lastError: string | null;
  readonly processedAt: Date | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly subject: JobSubject;
  /** Whether `POST /admin/jobs/:jobId/retry` would accept it. */
  readonly retryable: boolean;
}

const JOB_SELECT = {
  id: true,
  eventType: true,
  status: true,
  attemptCount: true,
  nextAttemptAt: true,
  lastError: true,
  processedAt: true,
  createdAt: true,
  updatedAt: true,
  payload: true,
} as const satisfies Prisma.OutboxEventSelect;

type JobRow = Prisma.OutboxEventGetPayload<{ select: typeof JOB_SELECT }>;

const RETRYABLE: ReadonlySet<OutboxStatus> = new Set(['FAILED', 'DEAD']);

function toView(row: JobRow): JobView {
  const recurring = RECURRING_TYPES.has(row.eventType);
  const finished = row.status === 'SENT' || row.status === 'DEAD';

  return {
    id: row.id,
    eventType: row.eventType,
    status: row.status,
    recurring,
    attemptCount: row.attemptCount,
    maxAttempts: recurring ? null : MAX_ATTEMPTS,
    nextAttemptAt: finished ? null : row.nextAttemptAt,
    lastError: row.lastError,
    processedAt: row.processedAt,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    subject: jobSubject(row.payload),
    retryable: RETRYABLE.has(row.status) && !isScrubbed(row.payload),
  };
}

export interface JobFilters {
  readonly status?: OutboxStatus;
  readonly type?: OutboxEventType;
}

export async function listJobs(
  pagination: Pagination,
  filters: JobFilters,
): Promise<{ items: JobView[]; total: number }> {
  const { skip, take } = toSkipTake(pagination);
  const where: Prisma.OutboxEventWhereInput = {
    ...(filters.status ? { status: filters.status } : {}),
    ...(filters.type ? { eventType: filters.type } : {}),
  };

  const [rows, total] = await Promise.all([
    prisma.outboxEvent.findMany({
      where,
      // Newest first, with the id as a tie-break so pages do not overlap.
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      skip,
      take,
      select: JOB_SELECT,
    }),
    prisma.outboxEvent.count({ where }),
  ]);

  return { items: rows.map(toView), total };
}

export interface JobSummary {
  /** One-off jobs only; the recurring sweep is reported under `reconciliation`. */
  readonly counts: Readonly<Record<OutboxStatus, number>>;
  /** Waiting for a try right now. Above zero for long means no worker is running. */
  readonly due: number;
  /** DEAD jobs that `POST /admin/jobs/retry` would requeue (expired account emails are not). */
  readonly retryableDead: number;
  /** The longest-waiting due job's scheduled time: how far behind the queue is. */
  readonly oldestDueAt: Date | null;
  readonly reconciliation: {
    readonly status: OutboxStatus;
    readonly lastRunAt: Date | null;
    readonly nextRunAt: Date;
    /** Failed runs since the last success. */
    readonly failingRuns: number;
    readonly lastError: string | null;
  } | null;
}

export async function jobSummary(now: Date = new Date()): Promise<JobSummary> {
  const oneOff: Prisma.OutboxEventWhereInput = { eventType: { notIn: [...RECURRING_TYPES] } };
  const dueWhere: Prisma.OutboxEventWhereInput = {
    ...oneOff,
    status: { in: ['PENDING', 'FAILED'] },
    nextAttemptAt: { lte: now },
  };

  const [groups, due, retryableDead, oldest, sweep] = await Promise.all([
    prisma.outboxEvent.groupBy({ by: ['status'], where: oneOff, _count: { _all: true } }),
    prisma.outboxEvent.count({ where: dueWhere }),
    prisma.outboxEvent.count({
      where: { status: 'DEAD', eventType: { notIn: [...SCRUB_ON_FINISH, ...RECURRING_TYPES] } },
    }),
    prisma.outboxEvent.findFirst({
      where: dueWhere,
      orderBy: { nextAttemptAt: 'asc' },
      select: { nextAttemptAt: true },
    }),
    prisma.outboxEvent.findUnique({
      where: { dedupeKey: RECONCILIATION_DEDUPE_KEY },
      select: {
        status: true,
        processedAt: true,
        nextAttemptAt: true,
        attemptCount: true,
        lastError: true,
      },
    }),
  ]);

  const counts: Record<OutboxStatus, number> = {
    PENDING: 0,
    PROCESSING: 0,
    SENT: 0,
    FAILED: 0,
    DEAD: 0,
  };
  for (const group of groups) counts[group.status] = group._count._all;

  return {
    counts,
    due,
    retryableDead,
    oldestDueAt: oldest?.nextAttemptAt ?? null,
    reconciliation: sweep
      ? {
          status: sweep.status,
          lastRunAt: sweep.processedAt,
          nextRunAt: sweep.nextAttemptAt,
          failingRuns: sweep.status === 'FAILED' ? sweep.attemptCount : 0,
          lastError: sweep.lastError,
        }
      : null,
  };
}

/** What the retry puts back: a fresh set of tries, due now. */
function requeue(now: Date) {
  return { status: 'PENDING' as const, attemptCount: 0, nextAttemptAt: now };
}

/**
 * `POST /admin/jobs/:jobId/retry`. Only a FAILED or DEAD job, and only if it can still be sent:
 * an account email whose link has been removed cannot, and the customer must ask for a new one.
 * The update is conditional on the status read, so two admins retrying at once retry it once.
 */
export async function retryJob(
  jobId: string,
  context: AdminActionContext,
  now: Date = new Date(),
): Promise<JobView> {
  return withTransaction(
    async (tx) => {
      const row = await tx.outboxEvent.findUnique({ where: { id: jobId }, select: JOB_SELECT });

      if (!row) throw notFound('That job does not exist.');
      if (!RETRYABLE.has(row.status)) {
        throw conflict(
          row.status === 'SENT'
            ? 'That job has already been sent.'
            : 'That job is already waiting to run.',
        );
      }
      if (isScrubbed(row.payload)) {
        throw conflict(
          'That account email can no longer be sent: its link was removed. The customer must ask for a new one.',
        );
      }

      const { count } = await tx.outboxEvent.updateMany({
        where: { id: jobId, status: row.status },
        data: requeue(now),
      });

      if (count === 0)
        throw conflict('That job changed while you were looking at it. Reload and try again.');

      await recordAudit(tx, {
        action: AuditAction.JOB_RETRIED,
        entityType: 'OutboxEvent',
        entityId: jobId,
        actor: context.actor,
        before: { status: row.status, attemptCount: row.attemptCount, eventType: row.eventType },
        after: { status: 'PENDING', attemptCount: 0 },
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      });

      return toView(
        await tx.outboxEvent.findUniqueOrThrow({ where: { id: jobId }, select: JOB_SELECT }),
      );
    },
    { label: 'jobs.retry' },
  );
}

/** At most this many in one request, so the write stays a short transaction. */
export const BULK_RETRY_LIMIT = 500;

/**
 * `POST /admin/jobs/retry`: requeues DEAD jobs that can still be sent, oldest first, up to
 * `BULK_RETRY_LIMIT`. One audit row records how many and which type.
 */
export async function retryDeadJobs(
  filters: { readonly type?: OutboxEventType },
  context: AdminActionContext,
  now: Date = new Date(),
): Promise<{ retried: number; remaining: number }> {
  return withTransaction(
    async (tx) => {
      const where: Prisma.OutboxEventWhereInput = {
        status: 'DEAD',
        // A DEAD account email has always had its link removed (`SCRUB_ON_FINISH`), so it can
        // never be sent again. Filtering by type rather than by a JSON path matters: `NOT` over a
        // path that is absent is NULL in SQL, which would drop every other row too.
        eventType: filters.type
          ? { equals: filters.type, notIn: [...SCRUB_ON_FINISH] }
          : { notIn: [...SCRUB_ON_FINISH] },
      };
      const candidates = await tx.outboxEvent.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        take: BULK_RETRY_LIMIT,
        select: { id: true },
      });
      const ids = candidates.map((row) => row.id);

      const { count } =
        ids.length === 0
          ? { count: 0 }
          : await tx.outboxEvent.updateMany({
              where: { id: { in: ids }, status: 'DEAD' },
              data: requeue(now),
            });

      if (count > 0) {
        await recordAudit(tx, {
          action: AuditAction.JOBS_BULK_RETRIED,
          entityType: 'OutboxEvent',
          entityId: filters.type ?? 'ALL',
          actor: context.actor,
          before: { status: 'DEAD', ...(filters.type ? { eventType: filters.type } : {}) },
          after: { status: 'PENDING', count },
          ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
          ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
        });
      }

      return { retried: count, remaining: await tx.outboxEvent.count({ where }) };
    },
    { label: 'jobs.bulkRetry' },
  );
}
