import { withRetry } from '../../src/lib/async.js';
import { prisma } from '../../src/lib/prisma.js';
import { syncAssistantIndex } from '../../src/modules/assistant/indexer.js';
import { assistantProviders } from '../../src/modules/assistant/providers/registry.js';
import { AssistantProviderUnavailableError } from '../../src/modules/assistant/providers/types.js';

/**
 * Refreshes the shopping assistant's search index now (`npm run assistant:index`): the knowledge
 * files in `content/assistant/` and every public product. Only changed rows are embedded, so a
 * rerun is cheap. The worker does the same on a schedule (ASSISTANT_INDEX_INTERVAL_MS).
 */
const providers = assistantProviders();

if (!providers) {
  process.stderr.write(
    'The assistant is not configured: set GROQ_API_KEY and GROQ_CHAT_MODEL (or the OpenAI keys) ' +
      'in backend/.env (docs/assistant-setup.md).\n',
  );
  process.exit(1);
}

try {
  // A provider that is still starting (the E2E stand-in) or briefly unreachable is retried a few
  // times; a refusal such as a wrong key is not. A rerun only embeds what is still missing.
  const report = await withRetry(() => syncAssistantIndex(providers.embeddings), {
    attempts: 5,
    baseDelayMs: 1_000,
    label: 'assistant index',
    isRetryable: (error) =>
      error instanceof AssistantProviderUnavailableError &&
      (error.failure === 'network' ||
        error.failure === 'timeout' ||
        error.failure === 'rate_limited'),
  });
  process.stdout.write(
    [
      `Knowledge: ${String(report.documents.embedded)} ${providers.embeddings ? 'embedded' : 'indexed as text'}, ${String(report.documents.unchanged)} unchanged, ${String(report.documents.removed)} removed`,
      report.products
        ? `Products:  ${String(report.products.embedded)} embedded, ${String(report.products.unchanged)} unchanged, ${String(report.products.removed)} removed`
        : 'Products:  skipped (no OPENAI_API_KEY; the assistant uses the catalog keyword search)',
      '',
    ].join('\n'),
  );
} finally {
  await prisma.$disconnect();
}
