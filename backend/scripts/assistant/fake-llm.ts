import { createHash } from 'node:crypto';
import { type IncomingMessage, type Server, type ServerResponse, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

/**
 * A stand-in for an OpenAI-compatible vendor (Groq or OpenAI) for the integration suite, the
 * browser suite and local tries without keys (`npm run assistant:fake-llm`). ADR 0025, decision 12.
 *
 * It lives outside `src/`, so it is never in the build, and the real adapter talks to it over real
 * HTTP: only the base URL differs. It implements the two endpoints the store uses:
 * `POST /chat/completions` (streamed, with tool calls) and `POST /embeddings` (deterministic
 * vectors, so the same text always lands in the same place and shared words land nearby).
 *
 * It does not imitate a model's judgement. By default it follows a fixed policy: on a customer's
 * question it calls the most fitting tool once, then answers by listing what the tool returned.
 * Tests replace `responder` to script exact turns.
 */

export interface FakeChatRequest {
  readonly model: string;
  readonly messages: readonly Record<string, unknown>[];
  readonly tools: readonly { function: { name: string } }[];
}

export interface FakeTurn {
  readonly text?: string;
  readonly toolCalls?: readonly { readonly name: string; readonly arguments: unknown }[];
}

export type FakeResponder = (request: FakeChatRequest) => FakeTurn;

/**
 * `midstream`: a few words, then the connection is cut. `garbage`: a 200 whose stream is not
 * JSON. `hang`: never answers.
 */
export type FakeLlmOutage = 'none' | 'http500' | 'rate_limit' | 'hang' | 'garbage' | 'midstream';

export interface FakeLlmOptions {
  readonly apiKey: string;
  readonly port?: number;
  /** Report usage the way Groq does (`x_groq.usage`) instead of OpenAI's final chunk. */
  readonly groqUsage?: boolean;
  readonly dimensions?: number;
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      resolve(Buffer.concat(chunks).toString('utf8'));
    });
    req.on('error', reject);
  });
}

function json(res: ServerResponse, body: unknown, status = 200): void {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
}

/**
 * A bag-of-words vector: every lower-cased word adds weight to a few hashed dimensions, then the
 * vector is normalised. Texts sharing words have a high cosine similarity; unrelated texts are
 * near zero. Exported so tests can reason about what will be retrieved.
 */
export function fakeEmbedding(text: string, dimensions = 1536): number[] {
  const vector = new Array<number>(dimensions).fill(0);
  const words = text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];

  for (const word of words) {
    const digest = createHash('sha256').update(word).digest();
    for (let i = 0; i < 4; i += 1) {
      const index = digest.readUInt16BE(i * 2) % dimensions;
      vector[index] = (vector[index] ?? 0) + (digest[8 + i]! % 2 === 0 ? 1 : -1);
    }
  }

  const norm = Math.sqrt(vector.reduce((sum, value) => sum + value * value, 0));
  if (norm === 0) {
    vector[0] = 1;
    return vector;
  }
  return vector.map((value) => value / norm);
}

function lastOfRole(
  messages: readonly Record<string, unknown>[],
  role: string,
): Record<string, unknown> | undefined {
  return [...messages].reverse().find((message) => message.role === role);
}

/**
 * The default policy. A question → one tool call chosen by keyword; tool results → a short answer
 * naming what came back. Enough to drive the widget end to end without a model.
 */
export const defaultResponder: FakeResponder = (request) => {
  const last = request.messages.at(-1);
  const toolNames = new Set(request.tools.map((tool) => tool.function.name));

  if (last?.role === 'tool') {
    const results = request.messages.filter((message) => message.role === 'tool');
    const lastContent = results.at(-1)?.content;
    const lastResult = typeof lastContent === 'string' ? lastContent : '';
    const names = [...lastResult.matchAll(/"name":"([^"]+)"/g)].map((match) => match[1]);
    const titles = [...lastResult.matchAll(/"title":"([^"]+)"/g)].map((match) => match[1]);
    const orders = [...lastResult.matchAll(/"orderNumber":"([^"]+)"/g)].map((match) => match[1]);

    if (orders.length > 0) {
      return { text: `I found your order ${orders.join(', ')}.` };
    }
    if (names.length > 0) {
      return { text: `Here is what I found: ${names.slice(0, 3).join(', ')}.` };
    }
    if (titles.length > 0) {
      return { text: `According to our ${titles[0]} page, see the details there.` };
    }
    return { text: "I couldn't find anything matching that." };
  }

  const userContent = lastOfRole(request.messages, 'user')?.content;
  const question = typeof userContent === 'string' ? userContent : '';
  const lower = question.toLowerCase();

  if (/\border/.test(lower) && toolNames.has('list_my_orders')) {
    return { toolCalls: [{ name: 'list_my_orders', arguments: {} }] };
  }
  if (
    /deliver|shipping|return|refund|pay|policy/.test(lower) &&
    toolNames.has('search_store_policies')
  ) {
    return { toolCalls: [{ name: 'search_store_policies', arguments: { query: question } }] };
  }
  if (toolNames.has('semantic_search_products')) {
    return { toolCalls: [{ name: 'semantic_search_products', arguments: { query: question } }] };
  }
  return { text: 'Hello! Ask me about our products.' };
};

export class FakeLlm {
  private server: Server | undefined;
  private port = 0;
  outage: FakeLlmOutage = 'none';
  responder: FakeResponder = defaultResponder;
  /** Every chat request received, for asserting what the store sent (tools offered, messages). */
  readonly chatRequests: FakeChatRequest[] = [];
  embeddingRequests = 0;
  embeddedTexts = 0;
  /** Answer embeddings of this size whatever was asked, to simulate a misconfigured model. */
  embeddingDimensionsOverride: number | null = null;

  constructor(private readonly options: FakeLlmOptions) {}

  get baseUrl(): string {
    return `http://127.0.0.1:${String(this.port)}`;
  }

  async start(): Promise<void> {
    this.server = createServer((req, res) => {
      this.route(req, res).catch(() => {
        if (!res.headersSent) json(res, { error: { message: 'fake failure' } }, 500);
        else res.destroy();
      });
    });

    await new Promise<void>((resolve, reject) => {
      this.server?.once('error', reject);
      this.server?.listen(this.options.port ?? 0, '127.0.0.1', resolve);
    });

    this.port = (this.server.address() as AddressInfo).port;
  }

  async stop(): Promise<void> {
    await new Promise<void>((resolve) => {
      this.server?.closeAllConnections();
      this.server?.close(() => {
        resolve();
      });
    });
  }

  reset(): void {
    this.outage = 'none';
    this.responder = defaultResponder;
    this.chatRequests.length = 0;
    this.embeddingRequests = 0;
    this.embeddedTexts = 0;
    this.embeddingDimensionsOverride = null;
  }

  private async route(req: IncomingMessage, res: ServerResponse): Promise<void> {
    const body = await readBody(req);

    if (req.headers.authorization !== `Bearer ${this.options.apiKey}`) {
      json(res, { error: { message: 'invalid api key' } }, 401);
      return;
    }

    const path = (req.url ?? '').replace(/\?.*$/, '');

    if (req.method === 'POST' && path.endsWith('/embeddings')) {
      this.embeddingRequests += 1;
      if (this.outage === 'hang') return;
      if (this.outage === 'http500') return json(res, { error: { message: 'down' } }, 500);
      if (this.outage === 'rate_limit') return json(res, { error: { message: 'slow down' } }, 429);
      const parsed = JSON.parse(body) as { input: string[]; dimensions?: number };
      this.embeddedTexts += parsed.input.length;
      const dimensions =
        this.embeddingDimensionsOverride ?? parsed.dimensions ?? this.options.dimensions ?? 1536;
      json(res, {
        object: 'list',
        data: parsed.input.map((text, index) => ({
          object: 'embedding',
          index,
          embedding: fakeEmbedding(text, dimensions),
        })),
        usage: { prompt_tokens: parsed.input.join(' ').length, total_tokens: 0 },
      });
      return;
    }

    if (req.method === 'POST' && path.endsWith('/chat/completions')) {
      const parsed = JSON.parse(body) as {
        model: string;
        messages: Record<string, unknown>[];
        tools?: { function: { name: string } }[];
        stream_options?: { include_usage?: boolean };
      };
      const request: FakeChatRequest = {
        model: parsed.model,
        messages: parsed.messages,
        tools: parsed.tools ?? [],
      };
      this.chatRequests.push(request);

      if (this.outage === 'hang') return;
      if (this.outage === 'http500') return json(res, { error: { message: 'down' } }, 500);
      if (this.outage === 'rate_limit') return json(res, { error: { message: 'slow down' } }, 429);

      res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });

      if (this.outage === 'garbage') {
        res.end('data: {not json\n\n');
        return;
      }

      const turn = this.responder(request);
      const send = (payload: unknown): void => {
        res.write(`data: ${JSON.stringify(payload)}\n\n`);
      };
      const base = { id: 'fake', object: 'chat.completion.chunk', model: parsed.model };
      const words = (turn.text ?? '').split(/(?<= )/);
      const usage = {
        prompt_tokens: JSON.stringify(parsed.messages).length >> 2,
        completion_tokens: Math.max(1, (turn.text ?? '').length >> 2),
        total_tokens: 0,
      };

      if (this.outage === 'midstream') {
        send({ ...base, choices: [{ index: 0, delta: { content: 'Let me ' } }] });
        // Let the first piece reach the client before the connection drops.
        setTimeout(() => {
          res.destroy();
        }, 50).unref();
        return;
      }

      for (const word of words) {
        if (word !== '') send({ ...base, choices: [{ index: 0, delta: { content: word } }] });
      }

      (turn.toolCalls ?? []).forEach((call, index) => {
        send({
          ...base,
          choices: [
            {
              index: 0,
              delta: {
                tool_calls: [
                  {
                    index,
                    id: `call_${String(this.chatRequests.length)}_${String(index)}`,
                    type: 'function',
                    function: { name: call.name, arguments: '' },
                  },
                ],
              },
            },
          ],
        });
        // Arguments arrive in pieces, as real vendors send them.
        const text = JSON.stringify(call.arguments);
        for (let i = 0; i < text.length; i += 8) {
          send({
            ...base,
            choices: [
              {
                index: 0,
                delta: { tool_calls: [{ index, function: { arguments: text.slice(i, i + 8) } }] },
              },
            ],
          });
        }
      });

      const finishReason = (turn.toolCalls ?? []).length > 0 ? 'tool_calls' : 'stop';
      send({
        ...base,
        choices: [{ index: 0, delta: {}, finish_reason: finishReason }],
        ...(this.options.groqUsage ? { x_groq: { usage } } : {}),
      });
      if (parsed.stream_options?.include_usage) {
        send({ ...base, choices: [], usage });
      }
      res.end('data: [DONE]\n\n');
      return;
    }

    json(res, { error: { message: 'not found' } }, 404);
  }
}
