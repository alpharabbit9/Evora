import {
  AssistantProviderUnavailableError,
  type ChatMessage,
  type ChatProvider,
  type ChatProviderName,
  type ChatRequest,
  type ChatStreamEvent,
  type EmbeddingProvider,
  type ToolCall,
  type TokenUsage,
} from './types.js';

/**
 * One adapter for every vendor that speaks the OpenAI chat-completions protocol: Groq at
 * `https://api.groq.com/openai/v1` and OpenAI itself (ADR 0025). Plain `fetch`, like the
 * SSLCOMMERZ adapter: the wire format is small and stable, and no SDK means no dependency to
 * audit and nothing between our timeouts and the socket.
 *
 * Every failure becomes `AssistantProviderUnavailableError`, so the service has one thing to
 * catch and decide on (fall back, or tell the customer).
 */

export interface OpenAiCompatibleConfig {
  readonly name: ChatProviderName;
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  /** No first byte within this long: give up (the fallback still has time). */
  readonly firstByteTimeoutMs?: number;
  /** No further chunk within this long once streaming. */
  readonly idleTimeoutMs?: number;
  /** OpenAI reports usage in the stream only when asked; Groq reports it unasked. */
  readonly requestStreamUsage?: boolean;
}

const DEFAULT_FIRST_BYTE_TIMEOUT_MS = 15_000;
const DEFAULT_IDLE_TIMEOUT_MS = 20_000;
const EMBEDDING_TIMEOUT_MS = 20_000;

function endpoint(baseUrl: string, path: string): string {
  return `${baseUrl.replace(/\/+$/, '')}${path}`;
}

/** Our message shape to the wire shape. */
export function toWireMessages(messages: readonly ChatMessage[]): unknown[] {
  return messages.map((message) => {
    switch (message.role) {
      case 'system':
      case 'user':
        return { role: message.role, content: message.content };
      case 'assistant':
        return {
          role: 'assistant',
          content: message.content,
          ...(message.toolCalls && message.toolCalls.length > 0
            ? {
                tool_calls: message.toolCalls.map((call) => ({
                  id: call.id,
                  type: 'function',
                  function: { name: call.name, arguments: call.arguments },
                })),
              }
            : {}),
        };
      case 'tool':
        return { role: 'tool', tool_call_id: message.toolCallId, content: message.content };
    }
  });
}

function failureFor(status: number): AssistantProviderUnavailableError['failure'] {
  return status === 429 ? 'rate_limited' : 'http_error';
}

/**
 * Splits a byte stream into server-sent-event `data:` payloads. Exported for tests. Comment
 * lines and other fields are ignored; events are separated by a blank line.
 */
export async function* readSseData(
  body: AsyncIterable<Uint8Array>,
): AsyncGenerator<string, void, undefined> {
  const decoder = new TextDecoder();
  let buffer = '';

  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true });
    buffer = buffer.replace(/\r\n/g, '\n');

    let boundary = buffer.indexOf('\n\n');
    while (boundary !== -1) {
      const block = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      const data = block
        .split('\n')
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice(5).replace(/^ /, ''))
        .join('\n');
      if (data !== '') {
        yield data;
      }
      boundary = buffer.indexOf('\n\n');
    }
  }

  buffer += decoder.decode();
  const tail = buffer
    .split('\n')
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).replace(/^ /, ''))
    .join('\n');
  if (tail !== '') {
    yield tail;
  }
}

interface PartialCall {
  id: string;
  name: string;
  arguments: string;
}

function readUsage(value: unknown): TokenUsage | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const input = record.prompt_tokens;
  const output = record.completion_tokens;
  if (typeof input === 'number' && typeof output === 'number') {
    return { inputTokens: input, outputTokens: output };
  }
  return null;
}

/**
 * Bounds each wait on the stream. The timer is reset by every chunk, so a slow but steady
 * answer is fine and a stalled one is not.
 */
class Watchdog {
  private timer: NodeJS.Timeout | undefined;
  expired = false;

  constructor(private readonly controller: AbortController) {}

  arm(ms: number): void {
    this.clear();
    this.timer = setTimeout(() => {
      this.expired = true;
      this.controller.abort();
    }, ms);
    this.timer.unref();
  }

  clear(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
  }
}

export function createOpenAiCompatibleChatProvider(config: OpenAiCompatibleConfig): ChatProvider {
  const firstByteTimeoutMs = config.firstByteTimeoutMs ?? DEFAULT_FIRST_BYTE_TIMEOUT_MS;
  const idleTimeoutMs = config.idleTimeoutMs ?? DEFAULT_IDLE_TIMEOUT_MS;

  async function* stream(request: ChatRequest): AsyncGenerator<ChatStreamEvent, void, undefined> {
    const controller = new AbortController();
    const watchdog = new Watchdog(controller);
    const onCallerAbort = (): void => {
      controller.abort();
    };
    request.signal?.addEventListener('abort', onCallerAbort, { once: true });

    const unavailable = (
      failure: AssistantProviderUnavailableError['failure'],
      status: number | null = null,
    ) => new AssistantProviderUnavailableError(config.name, failure, status);

    try {
      watchdog.arm(firstByteTimeoutMs);

      let response: Response;
      try {
        response = await fetch(endpoint(config.baseUrl, '/chat/completions'), {
          method: 'POST',
          headers: {
            authorization: `Bearer ${config.apiKey}`,
            'content-type': 'application/json',
            accept: 'text/event-stream',
          },
          body: JSON.stringify({
            model: config.model,
            messages: toWireMessages(request.messages),
            ...(request.tools.length > 0
              ? {
                  tools: request.tools.map((tool) => ({
                    type: 'function',
                    function: {
                      name: tool.name,
                      description: tool.description,
                      parameters: tool.parameters,
                    },
                  })),
                  tool_choice: 'auto',
                }
              : {}),
            max_tokens: request.maxTokens,
            stream: true,
            ...(config.requestStreamUsage ? { stream_options: { include_usage: true } } : {}),
          }),
          signal: controller.signal,
        });
      } catch {
        throw unavailable(watchdog.expired ? 'timeout' : 'network');
      }

      if (!response.ok || !response.body) {
        // Drain without reading the body into an error message: it may echo the request.
        await response.body?.cancel().catch(() => undefined);
        throw unavailable(failureFor(response.status), response.status);
      }

      const calls = new Map<number, PartialCall>();
      let finishReason = 'stop';
      let usage: TokenUsage | null = null;
      let sawDone = false;
      let sawFinish = false;

      watchdog.arm(idleTimeoutMs);

      try {
        for await (const data of readSseData(response.body)) {
          watchdog.arm(idleTimeoutMs);

          if (data === '[DONE]') {
            sawDone = true;
            break;
          }

          let chunk: Record<string, unknown>;
          try {
            chunk = JSON.parse(data) as Record<string, unknown>;
          } catch {
            throw unavailable('bad_response');
          }

          usage =
            readUsage(chunk.usage) ??
            readUsage((chunk.x_groq as Record<string, unknown> | undefined)?.usage) ??
            usage;

          const choices = Array.isArray(chunk.choices) ? chunk.choices : [];
          const choice = choices[0] as Record<string, unknown> | undefined;
          if (!choice) {
            continue;
          }

          const delta = (choice.delta ?? {}) as Record<string, unknown>;
          if (typeof delta.content === 'string' && delta.content !== '') {
            yield { type: 'text', text: delta.content };
          }

          if (Array.isArray(delta.tool_calls)) {
            for (const raw of delta.tool_calls as Record<string, unknown>[]) {
              const index = typeof raw.index === 'number' ? raw.index : 0;
              const fn = (raw.function ?? {}) as Record<string, unknown>;
              const existing = calls.get(index) ?? { id: '', name: '', arguments: '' };
              if (typeof raw.id === 'string') existing.id = raw.id;
              if (typeof fn.name === 'string') existing.name += fn.name;
              if (typeof fn.arguments === 'string') existing.arguments += fn.arguments;
              calls.set(index, existing);
            }
          }

          if (typeof choice.finish_reason === 'string') {
            finishReason = choice.finish_reason;
            sawFinish = true;
          }
        }
      } catch (error) {
        if (error instanceof AssistantProviderUnavailableError) throw error;
        throw unavailable(watchdog.expired ? 'timeout' : 'network');
      }

      if (!sawDone && !sawFinish) {
        // The connection ended without the protocol's end marker or anything that ends a turn.
        throw unavailable('bad_response');
      }

      if (calls.size > 0) {
        const complete: ToolCall[] = [...calls.entries()]
          .sort(([a], [b]) => a - b)
          .map(([index, call]) => ({
            id: call.id || `call_${String(index)}`,
            name: call.name,
            arguments: call.arguments,
          }));
        if (complete.some((call) => call.name === '')) {
          throw unavailable('bad_response');
        }
        yield { type: 'tool_calls', calls: complete };
      }

      yield { type: 'end', finishReason, usage };
    } finally {
      watchdog.clear();
      request.signal?.removeEventListener('abort', onCallerAbort);
    }
  }

  return { name: config.name, model: config.model, stream };
}

export interface EmbeddingConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly model: string;
  readonly dimensions: number;
  readonly timeoutMs?: number;
}

export function createOpenAiEmbeddingProvider(config: EmbeddingConfig): EmbeddingProvider {
  async function embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]> {
    if (texts.length === 0) {
      return [];
    }

    const timeout = AbortSignal.timeout(config.timeoutMs ?? EMBEDDING_TIMEOUT_MS);
    const combined = signal ? AbortSignal.any([signal, timeout]) : timeout;

    let response: Response;
    try {
      response = await fetch(endpoint(config.baseUrl, '/embeddings'), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${config.apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: config.model,
          input: texts,
          dimensions: config.dimensions,
        }),
        signal: combined,
      });
    } catch {
      throw new AssistantProviderUnavailableError(
        'openai',
        timeout.aborted ? 'timeout' : 'network',
      );
    }

    if (!response.ok) {
      await response.body?.cancel().catch(() => undefined);
      throw new AssistantProviderUnavailableError(
        'openai',
        failureFor(response.status),
        response.status,
      );
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new AssistantProviderUnavailableError('openai', 'bad_response');
    }

    const data = (body as { data?: unknown }).data;
    if (!Array.isArray(data) || data.length !== texts.length) {
      throw new AssistantProviderUnavailableError('openai', 'bad_response');
    }

    const vectors: number[][] = new Array<number[]>(texts.length);
    for (const item of data as { index?: unknown; embedding?: unknown }[]) {
      const index = item.index;
      const embedding = item.embedding;
      if (
        typeof index !== 'number' ||
        index < 0 ||
        index >= texts.length ||
        !Array.isArray(embedding) ||
        embedding.length !== config.dimensions ||
        !embedding.every((value) => typeof value === 'number' && Number.isFinite(value))
      ) {
        throw new AssistantProviderUnavailableError('openai', 'bad_response');
      }
      vectors[index] = embedding as number[];
    }

    if (vectors.some((vector) => vector === undefined)) {
      throw new AssistantProviderUnavailableError('openai', 'bad_response');
    }

    return vectors;
  }

  return { name: 'openai', model: config.model, dimensions: config.dimensions, embed };
}
