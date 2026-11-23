import { logger } from '../../src/lib/logger.js';
import { prisma } from '../../src/lib/prisma.js';
import { reconcilePayments } from '../../src/modules/payments/payments.service.js';
import { reconcileRefunds } from '../../src/modules/refunds/refunds.service.js';

/**
 * One reconciliation pass (`npm run payments:reconcile`). Settles payments no notification reached
 * and releases the stock of abandoned orders. Safe to run at any time and to repeat.
 *
 * The worker (`npm run worker`, ADR 0021) runs the same pass every RECONCILE_INTERVAL_MS as a
 * recurring job; this command is for running one by hand. Running both at once is safe.
 * Exits non-zero only when the pass itself failed.
 */
try {
  logger.info(await reconcilePayments(), 'Payment reconciliation finished');
  logger.info(await reconcileRefunds(), 'Refund reconciliation finished');
} catch (error) {
  logger.error({ err: error }, 'Payment reconciliation failed');
  process.exitCode = 1;
} finally {
  await prisma.$disconnect();
}
