import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { FakeLlm, fakeEmbedding } from '../scripts/assistant/fake-llm.js';
import { env } from '../src/config/env.js';
import {
  createOpenAiCompatibleChatProvider,
  createOpenAiEmbeddingProvider,
  readSseData,
} from '../src/modules/assistant/providers/openai-compatible.js';
import { buildAssistantProviders } from '../src/modules/assistant/providers/registry.js';
import {
  AssistantProviderUnavailableError,
  type ChatProvider,
  type ChatStreamEvent,
} from '../src/modules/assistant/providers/types.js';

function bytes(...parts: string[]): AsyncIterable<Uint8Array> {
  const encoder = new TextEncoder();
  return (async function* () {
    for (const part of parts) {
      await Promise.resolve();
      yield encoder.encode(part);
    }
  })();
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const item of iterable) items.push(item);
  return items;
}

async function failureOf(
  iterable: AsyncIterable<unknown>,
): Promise<AssistantProviderUnavailableError> {
  try {
    await collect(iterable);
  } catch (error) {
    if (error instanceof AssistantProviderUnavailableError) return error;
    throw error;
  }
  throw new Error('expected the stream to fail');
}

describe('readSseData', () => {
  it('yields each data payload, across chunk boundaries and CRLF line ends', async () => {
    const out = await collect(
      readSseData(bytes('data: {"a":1}\r\n\r\nda', 'ta: two\n\n: comment\n\n', 'data: [DONE]')),
    );

    expect(out).toEqual(['{"a":1}', 'two', '[DONE]']);
  });
});

describe('OpenAI-compatible chat adapter against the stand-in', () => {
  const groq = new FakeLlm({ apiKey: 'k-groq', groqUsage: true });
  const openai = new FakeLlm({ apiKey: 'k-openai' });
  let groqProvider: ChatProvider;
  let openaiProvider: ChatProvider;

  beforeAll(async () => {
    await groq.start();
    await openai.start();
    groqProvider = createOpenAiCompatibleChatProvider({
      name: 'groq',
      baseUrl: groq.baseUrl,
      apiKey: 'k-groq',
      model: 'm-groq',
      firstByteTimeoutMs: 300,
      idleTimeoutMs: 300,
    });
    openaiProvider = createOpenAiCompatibleChatProvider({
      name: 'openai',
      baseUrl: openai.baseUrl,
      apiKey: 'k-openai',
      model: 'm-openai',
      requestStreamUsage: true,
    });
  });

  afterAll(async () => {
    await groq.stop();
    await openai.stop();
  });

  beforeEach(() => {
    groq.reset();
    openai.reset();
  });

  const request = {
    messages: [{ role: 'user' as const, content: 'hi' }],
    tools: [],
    maxTokens: 100,
  };

  it('streams text and reads usage the way Groq reports it', async () => {
    groq.responder = () => ({ text: 'Hello there friend' });

    const events = await collect(groqProvider.stream(request));
    const text = events.flatMap((event) => (event.type === 'text' ? [event.text] : [])).join('');
    const end = events.at(-1) as Extract<ChatStreamEvent, { type: 'end' }>;

    expect(text).toBe('Hello there friend');
    expect(end).toMatchObject({ type: 'end', finishReason: 'stop' });
    expect(end.usage?.outputTokens).toBeGreaterThan(0);
    expect(groq.chatRequests[0]?.model).toBe('m-groq');
  });

  it('asks OpenAI for usage and reads its final usage chunk', async () => {
    openai.responder = () => ({ text: 'ok' });

    const events = await collect(openaiProvider.stream(request));

    expect((events.at(-1) as Extract<ChatStreamEvent, { type: 'end' }>).usage).not.toBeNull();
  });

  it('assembles tool calls whose arguments arrive in pieces', async () => {
    groq.responder = () => ({
      toolCalls: [
        { name: 'search_products', arguments: { q: 'linen shirt', maxPrice: 300_000 } },
        { name: 'get_product', arguments: { slug: 'a-very-long-product-slug-name' } },
      ],
    });

    const events = await collect(
      groqProvider.stream({
        ...request,
        tools: [{ name: 'search_products', description: 'd', parameters: { type: 'object' } }],
      }),
    );
    const calls = events.find((event) => event.type === 'tool_calls');

    expect(calls).toBeDefined();
    if (calls?.type !== 'tool_calls') return;
    expect(calls.calls.map((call) => call.name)).toEqual(['search_products', 'get_product']);
    expect(JSON.parse(calls.calls[0]!.arguments)).toEqual({ q: 'linen shirt', maxPrice: 300_000 });
    expect(JSON.parse(calls.calls[1]!.arguments)).toEqual({
      slug: 'a-very-long-product-slug-name',
    });
    expect(groq.chatRequests[0]?.tools.map((tool) => tool.function.name)).toEqual([
      'search_products',
    ]);
  });

  it.each([
    ['http500', 'http_error', 500],
    ['rate_limit', 'rate_limited', 429],
    ['garbage', 'bad_response', null],
    ['hang', 'timeout', null],
  ] as const)('turns a %s outage into %s', async (outage, failure, status) => {
    groq.outage = outage;

    const error = await failureOf(groqProvider.stream(request));

    expect(error.failure).toBe(failure);
    expect(error.httpStatus).toBe(status);
    expect(error.provider).toBe('groq');
  });

  it('yields what arrived, then fails, when the connection is cut mid-answer', async () => {
    groq.outage = 'midstream';
    const seen: ChatStreamEvent[] = [];

    const error = await failureOf(
      (async function* () {
        for await (const event of groqProvider.stream(request)) {
          seen.push(event);
          yield event;
        }
      })(),
    );

    expect(seen).toEqual([{ type: 'text', text: 'Let me ' }]);
    expect(['network', 'bad_response']).toContain(error.failure);
  });

  it('reports a rejected key as an HTTP error without leaking the key', async () => {
    const wrong = createOpenAiCompatibleChatProvider({
      name: 'groq',
      baseUrl: groq.baseUrl,
      apiKey: 'not-the-key',
      model: 'm',
    });

    const error = await failureOf(wrong.stream(request));

    expect(error.httpStatus).toBe(401);
    expect(error.message).not.toContain('not-the-key');
  });

  it('stops the provider call when the caller aborts', async () => {
    groq.outage = 'hang';
    const controller = new AbortController();
    const slow = createOpenAiCompatibleChatProvider({
      name: 'groq',
      baseUrl: groq.baseUrl,
      apiKey: 'k-groq',
      model: 'm',
      firstByteTimeoutMs: 10_000,
    });
    setTimeout(() => {
      controller.abort();
    }, 50);

    const error = await failureOf(slow.stream({ ...request, signal: controller.signal }));

    expect(error.failure).toBe('network');
  });
});

describe('OpenAI embeddings adapter against the stand-in', () => {
  const openai = new FakeLlm({ apiKey: 'k' });

  beforeAll(async () => {
    await openai.start();
  });

  afterAll(async () => {
    await openai.stop();
  });

  beforeEach(() => {
    openai.reset();
  });

  it('returns one vector per text, in order, of the configured size', async () => {
    const provider = createOpenAiEmbeddingProvider({
      baseUrl: openai.baseUrl,
      apiKey: 'k',
      model: 'm',
      dimensions: 1536,
    });

    const vectors = await provider.embed(['linen shirt', 'leather bag']);

    expect(vectors).toHaveLength(2);
    expect(vectors[0]).toEqual(fakeEmbedding('linen shirt'));
    expect(vectors[1]).toHaveLength(1536);
  });

  it('refuses vectors of the wrong size rather than storing them', async () => {
    openai.embeddingDimensionsOverride = 8;
    const provider = createOpenAiEmbeddingProvider({
      baseUrl: openai.baseUrl,
      apiKey: 'k',
      model: 'm',
      dimensions: 1536,
    });

    await expect(provider.embed(['x'])).rejects.toMatchObject({ failure: 'bad_response' });
  });

  it('makes no call for no texts', async () => {
    const provider = createOpenAiEmbeddingProvider({
      baseUrl: openai.baseUrl,
      apiKey: 'k',
      model: 'm',
      dimensions: 1536,
    });

    expect(await provider.embed([])).toEqual([]);
    expect(openai.embeddingRequests).toBe(0);
  });

  it.each([
    ['http500', 'http_error'],
    ['rate_limit', 'rate_limited'],
  ] as const)('turns a %s outage into %s', async (outage, failure) => {
    openai.outage = outage;
    const provider = createOpenAiEmbeddingProvider({
      baseUrl: openai.baseUrl,
      apiKey: 'k',
      model: 'm',
      dimensions: 1536,
    });

    await expect(provider.embed(['x'])).rejects.toMatchObject({ failure });
  });
});

describe('the stand-in embedding', () => {
  function cosine(a: number[], b: number[]): number {
    return a.reduce((sum, value, index) => sum + value * (b[index] ?? 0), 0);
  }

  it('puts texts with shared words closer than unrelated ones', () => {
    const query = fakeEmbedding('linen shirt for summer');

    expect(cosine(query, fakeEmbedding('white linen shirt'))).toBeGreaterThan(
      cosine(query, fakeEmbedding('leather ankle boots')),
    );
  });
});

describe('provider registry', () => {
  const base = { ...env, GROQ_API_KEY: undefined, OPENAI_API_KEY: undefined };

  it('is off without any chat provider', () => {
    expect(buildAssistantProviders(base)).toBeNull();
  });

  it('runs on Groq alone without an OpenAI key, with no embeddings and no fallback', () => {
    const providers = buildAssistantProviders({
      ...base,
      GROQ_API_KEY: 'g',
      GROQ_CHAT_MODEL: 'gm',
    });

    expect(providers?.chat.map((provider) => `${provider.name}:${provider.model}`)).toEqual([
      'groq:gm',
    ]);
    expect(providers?.embeddings).toBeNull();
  });

  it('is off with embeddings but no chat model', () => {
    expect(
      buildAssistantProviders({ ...base, OPENAI_API_KEY: 'o', OPENAI_CHAT_MODEL: undefined }),
    ).toBeNull();
  });

  it('tries Groq first and OpenAI second', () => {
    const providers = buildAssistantProviders({
      ...base,
      GROQ_API_KEY: 'g',
      GROQ_CHAT_MODEL: 'gm',
      OPENAI_API_KEY: 'o',
      OPENAI_CHAT_MODEL: 'om',
    });

    expect(providers?.chat.map((provider) => `${provider.name}:${provider.model}`)).toEqual([
      'groq:gm',
      'openai:om',
    ]);
    expect(providers?.embeddings?.dimensions).toBe(1536);
  });

  it('runs on OpenAI alone when Groq is not configured', () => {
    const providers = buildAssistantProviders({
      ...base,
      OPENAI_API_KEY: 'o',
      OPENAI_CHAT_MODEL: 'om',
    });

    expect(providers?.chat.map((provider) => provider.name)).toEqual(['openai']);
  });
});
