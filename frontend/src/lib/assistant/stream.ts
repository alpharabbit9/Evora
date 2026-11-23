import { ApiError, ApiErrorCode, type ApiErrorCodeName } from '@/lib/api-error';
import type { ProductCard } from '@/lib/catalog/types';
import { API_BASE_URL } from '@/lib/env';

/**
 * The shopping assistant's reply stream (ADR 0025; API_SPEC.md §8a). `POST /assistant/messages`
 * answers with server-sent events, which `EventSource` cannot send a body for, so this reads the
 * stream from `fetch` directly. A refusal before the stream starts (validation, 404, 429, 503) is
 * an ordinary error envelope and becomes an `ApiError`, like every other API call.
 */

export interface PolicySource {
  readonly title: string;
  readonly path: string;
  readonly draft: boolean;
}

export type AssistantEvent =
  | { type: 'meta'; conversationId: string; guestToken?: string; provider: string }
  | { type: 'delta'; text: string }
  | { type: 'products'; items: ProductCard[] }
  | { type: 'sources'; items: PolicySource[] }
  | { type: 'done'; messageId: string }
  | { type: 'error'; code: string; message: string };

export interface SendOptions {
  readonly message: string;
  readonly conversationId?: string | undefined;
  readonly guestToken?: string | undefined;
  readonly signal?: AbortSignal;
  readonly onEvent: (event: AssistantEvent) => void;
}

const KNOWN_CODES = new Set<string>(Object.values(ApiErrorCode));

async function errorFrom(response: Response): Promise<ApiError> {
  const body = (await response.json().catch(() => undefined)) as
    { error?: { code?: string; message?: string; requestId?: string } } | undefined;
  const code = body?.error?.code;
  return new ApiError(
    code && KNOWN_CODES.has(code) ? (code as ApiErrorCodeName) : ApiErrorCode.INTERNAL_ERROR,
    body?.error?.message ?? `Request failed with status ${String(response.status)}`,
    {
      status: response.status,
      ...(body?.error?.requestId ? { requestId: body.error.requestId } : {}),
    },
  );
}

/** Parses one `event:`/`data:` block. Unknown or malformed events are skipped. */
export function parseEventBlock(block: string): AssistantEvent | null {
  let type = '';
  const data: string[] = [];
  for (const line of block.split('\n')) {
    if (line.startsWith('event:')) type = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''));
  }
  if (type === '' || data.length === 0) return null;
  try {
    return { type, ...(JSON.parse(data.join('\n')) as object) } as AssistantEvent;
  } catch {
    return null;
  }
}

export async function sendAssistantMessage(options: SendOptions): Promise<void> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE_URL}/assistant/messages`, {
      method: 'POST',
      credentials: 'include',
      cache: 'no-store',
      headers: { 'content-type': 'application/json', accept: 'text/event-stream' },
      body: JSON.stringify({
        message: options.message,
        ...(options.conversationId ? { conversationId: options.conversationId } : {}),
        ...(options.guestToken ? { guestToken: options.guestToken } : {}),
      }),
      ...(options.signal ? { signal: options.signal } : {}),
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(ApiErrorCode.NETWORK_ERROR, 'The request could not be sent.', { cause });
  }

  if (!response.ok) throw await errorFrom(response);
  if (!response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) {
    throw new ApiError(ApiErrorCode.NETWORK_ERROR, 'The response could not be read.', {
      status: response.status,
    });
  }

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value.replace(/\r\n/g, '\n');
      let boundary = buffer.indexOf('\n\n');
      while (boundary !== -1) {
        const event = parseEventBlock(buffer.slice(0, boundary));
        buffer = buffer.slice(boundary + 2);
        if (event) options.onEvent(event);
        boundary = buffer.indexOf('\n\n');
      }
    }
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new ApiError(ApiErrorCode.NETWORK_ERROR, 'The connection was lost.', { cause });
  }
  const tail = parseEventBlock(buffer);
  if (tail) options.onEvent(tail);
}
