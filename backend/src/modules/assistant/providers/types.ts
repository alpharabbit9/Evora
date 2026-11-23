/**
 * What the assistant needs from a language-model vendor (ADR 0025). Groq and OpenAI both speak
 * the OpenAI chat-completions wire format, so one adapter (`openai-compatible.ts`) serves both;
 * this interface is what the service depends on, so tests and a future vendor need nothing else.
 */

export type ChatProviderName = 'groq' | 'openai';

export interface ToolCall {
  readonly id: string;
  readonly name: string;
  /** Raw JSON text as the model produced it. Parsed and validated by the caller. */
  readonly arguments: string;
}

export type ChatMessage =
  | { readonly role: 'system'; readonly content: string }
  | { readonly role: 'user'; readonly content: string }
  | {
      readonly role: 'assistant';
      readonly content: string | null;
      readonly toolCalls?: readonly ToolCall[];
    }
  | { readonly role: 'tool'; readonly toolCallId: string; readonly content: string };

export interface ToolSpec {
  readonly name: string;
  readonly description: string;
  /** JSON Schema for the arguments. */
  readonly parameters: Readonly<Record<string, unknown>>;
}

export interface ChatRequest {
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ToolSpec[];
  readonly maxTokens: number;
  /** Aborts the provider call when the customer goes away. */
  readonly signal?: AbortSignal;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/**
 * What one streamed completion yields, in order: any number of `text` pieces, then at most one
 * `tool_calls`, then exactly one `end`.
 */
export type ChatStreamEvent =
  | { readonly type: 'text'; readonly text: string }
  | { readonly type: 'tool_calls'; readonly calls: readonly ToolCall[] }
  | {
      readonly type: 'end';
      readonly finishReason: string;
      /** `null` when the provider did not report usage; the caller estimates. */
      readonly usage: TokenUsage | null;
    };

export interface ChatProvider {
  readonly name: ChatProviderName;
  readonly model: string;
  stream(request: ChatRequest): AsyncIterable<ChatStreamEvent>;
}

export interface EmbeddingProvider {
  readonly name: 'openai';
  readonly model: string;
  readonly dimensions: number;
  /** One vector per input, in input order. */
  embed(texts: readonly string[], signal?: AbortSignal): Promise<number[][]>;
}

export type ProviderFailure =
  'rate_limited' | 'http_error' | 'timeout' | 'network' | 'bad_response';

/**
 * The vendor gave no usable answer. The message is ours and safe to log: it never carries the
 * request, the response body or a key.
 */
export class AssistantProviderUnavailableError extends Error {
  readonly provider: string;
  readonly failure: ProviderFailure;
  readonly httpStatus: number | null;

  constructor(provider: string, failure: ProviderFailure, httpStatus: number | null = null) {
    super(
      `${provider} unavailable (${failure}${httpStatus === null ? '' : ` ${String(httpStatus)}`})`,
    );
    this.name = 'AssistantProviderUnavailableError';
    this.provider = provider;
    this.failure = failure;
    this.httpStatus = httpStatus;
  }
}
