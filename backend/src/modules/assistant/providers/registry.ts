import { env } from '../../../config/env.js';
import {
  createOpenAiCompatibleChatProvider,
  createOpenAiEmbeddingProvider,
} from './openai-compatible.js';
import type { ChatProvider, EmbeddingProvider } from './types.js';

/** The column type is `vector(1536)` (migration `assistant`). */
export const EMBEDDING_DIMENSIONS = 1536;

export interface AssistantProviders {
  /** In the order they are tried: Groq first, OpenAI as the fallback. Never empty. */
  readonly chat: readonly ChatProvider[];
  /**
   * OpenAI embeddings, or `null` without an OpenAI key. Then the assistant runs on Groq alone:
   * policies are found by full-text search and products by the catalog's keyword search, and the
   * meaning-based product search is not offered (ADR 0025, amendment of 2026-11-23).
   */
  readonly embeddings: EmbeddingProvider | null;
}

/**
 * The configured providers, or `null` when the assistant cannot run: it needs at least one chat
 * provider. `null` switches the feature off; the widget stays hidden (ADR 0025, decision 4).
 * Cached; `setAssistantProvidersForTests` replaces it.
 */
let cached: AssistantProviders | null | undefined;

export function buildAssistantProviders(config: typeof env): AssistantProviders | null {
  const chat: ChatProvider[] = [];

  if (config.GROQ_API_KEY && config.GROQ_CHAT_MODEL) {
    chat.push(
      createOpenAiCompatibleChatProvider({
        name: 'groq',
        baseUrl: config.GROQ_BASE_URL,
        apiKey: config.GROQ_API_KEY,
        model: config.GROQ_CHAT_MODEL,
      }),
    );
  }

  if (config.OPENAI_API_KEY && config.OPENAI_CHAT_MODEL) {
    chat.push(
      createOpenAiCompatibleChatProvider({
        name: 'openai',
        baseUrl: config.OPENAI_BASE_URL,
        apiKey: config.OPENAI_API_KEY,
        model: config.OPENAI_CHAT_MODEL,
        requestStreamUsage: true,
      }),
    );
  }

  if (chat.length === 0) {
    return null;
  }

  return {
    chat,
    embeddings: config.OPENAI_API_KEY
      ? createOpenAiEmbeddingProvider({
          baseUrl: config.OPENAI_BASE_URL,
          apiKey: config.OPENAI_API_KEY,
          model: config.OPENAI_EMBEDDING_MODEL,
          dimensions: EMBEDDING_DIMENSIONS,
        })
      : null,
  };
}

export function assistantProviders(): AssistantProviders | null {
  if (cached === undefined) {
    cached = buildAssistantProviders(env);
  }
  return cached;
}

/** Tests only: install stand-ins, or `undefined` to read the environment again. */
export function setAssistantProvidersForTests(
  providers: AssistantProviders | null | undefined,
): void {
  cached = providers;
}
