import { env } from './config/env.js';
import { logger } from './lib/logger.js';
import { prisma } from './lib/prisma.js';
import { drainDueJobs } from './modules/jobs/drain.js';
import { startWorker } from './modules/jobs/worker.js';
import { emailTransport } from './modules/notifications/transport.js';

/**
 * The background worker process (ADR 0021): `npm run worker` (built) or `npm run worker:dev`.
 * It is separate from the API so a slow email relay never competes with checkout for the event
 * loop, and so a host can run it as its own long-lived process.
 *
 * `--once` drains what is due and exits, for a host that can only schedule commands (a cron job,
 * a scheduled container): run it every minute or so. Running a long-lived worker and `--once`
 * at the same time is safe; they never take the same row.
 */
const MAX_ONCE_BATCHES = 50;

async function drainOnce(): Promise<void> {
  const summary = await drainDueJobs({ maxBatches: MAX_ONCE_BATCHES });
  logger.info(summary, 'Outbox drain finished');
  if (!summary.drained) {
    logger.warn({ batches: MAX_ONCE_BATCHES }, 'Stopped draining with jobs still due; run again');
  }
}

if (process.argv.includes('--once')) {
  try {
    await drainOnce();
  } catch (error) {
    logger.error({ err: error }, 'Outbox drain failed');
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
} else {
  const worker = startWorker({ transport: emailTransport() });
  logger.info(
    {
      emailDriver: env.EMAIL_DRIVER,
      pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
      batchSize: env.WORKER_BATCH_SIZE,
      reconcileIntervalMs: env.RECONCILE_INTERVAL_MS,
    },
    'CommerceCore worker started',
  );

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, 'Worker stopping after the batch in hand');
    // Not forever: a try cut short here is taken over by the next worker once its lease ends.
    setTimeout(() => process.exit(1), 30_000).unref();
    void worker
      .stop()
      .then(() => prisma.$disconnect())
      .finally(() => process.exit(0));
  };

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.on(signal, () => {
      shutdown(signal);
    });
  }
}
