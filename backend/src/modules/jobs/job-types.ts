import type { EmailTransport } from '../notifications/transport.js';
import type { ClaimedJob } from './outbox.store.js';

/**
 * One kind of background work. A handler runs after its claim committed and outside any
 * transaction; it must be safe to run again for the same row, because delivery is at least once
 * (ADR 0021). It reads what it needs at send time rather than trusting the payload, which holds
 * identifiers only.
 *
 * Throw `PermanentJobError` (or an `EmailDeliveryError` marked permanent) when no retry can help;
 * anything else thrown is retried with backoff. Return `{ skipped }` when there is nothing left to
 * do (the order was cancelled before its receipt went out): the row is finished, with the reason
 * kept for the dashboard.
 */
export interface JobContext {
  readonly transport: EmailTransport;
  readonly now: Date;
}

export type JobResult = undefined | { readonly skipped: string };

export type JobHandler = (job: ClaimedJob, context: JobContext) => Promise<JobResult>;
