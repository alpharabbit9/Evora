import type { OutboxEventType } from '@prisma/client';

import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import type { JobHandler } from '../jobs/job-types.js';
import { syncAssistantIndex } from './indexer.js';
import { assistantProviders } from './providers/registry.js';

/** Conversations are kept this long after their last message (ADR 0025, decision 8). */
export const CONVERSATION_RETENTION_DAYS = 30;

/** How often the retention purge runs. Daily retention needs no finer schedule. */
export const RETENTION_INTERVAL_MS = 6 * 60 * 60 * 1000;

/**
 * Refreshes the search index. Without providers the assistant is switched off, not failing: the
 * row is rescheduled quietly. On Groq alone only the policy text is refreshed (indexer.ts).
 */
const indexSweep: JobHandler = async () => {
  const providers = assistantProviders();
  if (!providers) {
    return { skipped: 'assistant not configured' };
  }

  const report = await syncAssistantIndex(providers.embeddings);
  logger.info({ report }, 'Assistant index sweep finished');
  return undefined;
};

/** Deletes whole conversations, with their messages, once the newest message is old enough. */
export async function purgeOldConversations(now: Date = new Date()): Promise<number> {
  const cutoff = new Date(now.getTime() - CONVERSATION_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  const { count } = await prisma.assistantConversation.deleteMany({
    where: { lastMessageAt: { lt: cutoff } },
  });
  return count;
}

const retention: JobHandler = async (_job, ctx) => {
  const deleted = await purgeOldConversations(ctx.now);
  logger.info({ deleted }, 'Assistant conversation retention finished');
  return undefined;
};

export const assistantHandlers = {
  ASSISTANT_INDEX_SWEEP: indexSweep,
  ASSISTANT_RETENTION: retention,
} satisfies Partial<Record<OutboxEventType, JobHandler>>;
