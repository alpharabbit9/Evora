import { createHash, randomBytes } from 'node:crypto';

import { env } from '../../config/env.js';
import { notFound, providerUnavailable, rateLimited } from '../../http/errors.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import type { ProductCardView } from '../catalog/products.service.js';
import { getStoreSettings } from '../settings/settings.service.js';
import { PROMPT_VERSION, systemPrompt } from './prompt.js';
import { assistantProviders, type AssistantProviders } from './providers/registry.js';
import {
  AssistantProviderUnavailableError,
  type ChatMessage,
  type ChatProvider,
  type TokenUsage,
  type ToolCall,
} from './providers/types.js';
import { type PolicySource, runTool, toolsFor } from './tools.js';

/**
 * One assistant turn, end to end (ADR 0025): check who is asking and what they may still spend,
 * save their message, run the model with tools until it answers, stream what it says, save the
 * answer. Nothing here writes domain state; the only rows it touches are its own.
 */

export const MAX_MESSAGE_CHARS = 1_000;
/** A conversation holds at most this many messages, the customer's and the assistant's. */
export const MAX_CONVERSATION_MESSAGES = 40;
/** Tool rounds per turn before the model must answer with what it has. */
export const MAX_TOOL_ROUNDS = 4;
/** Earlier messages the model sees, so a follow-up question has its context. */
const HISTORY_MESSAGES = 12;
const MAX_OUTPUT_TOKENS = 700;
const MAX_REPLY_CHARS = 8_000;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

/** The sender's IP, keyed with the auth secret so the stored value cannot be reversed by lookup. */
export function clientKeyHash(ip: string): string {
  return createHash('sha256').update(`${env.BETTER_AUTH_SECRET}\n${ip}`).digest('hex');
}

function startOfUtcDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export interface TurnRequest {
  readonly userId: string | null;
  readonly conversationId?: string | undefined;
  readonly guestToken?: string | undefined;
  readonly message: string;
  readonly ip: string;
}

export type AssistantEvent =
  | {
      readonly type: 'meta';
      readonly conversationId: string;
      readonly guestToken?: string;
      readonly provider: string;
    }
  | { readonly type: 'delta'; readonly text: string }
  | { readonly type: 'products'; readonly items: readonly ProductCardView[] }
  | { readonly type: 'sources'; readonly items: readonly PolicySource[] }
  | {
      readonly type: 'done';
      readonly messageId: string;
      readonly usage: { readonly inputTokens: number; readonly outputTokens: number };
    }
  | { readonly type: 'error'; readonly code: string; readonly message: string };

export interface PreparedTurn {
  readonly conversationId: string;
  /** Returned once, when a guest conversation is created; the browser keeps it for the tab. */
  readonly newGuestToken: string | undefined;
  readonly history: readonly ChatMessage[];
  readonly userId: string | null;
  readonly clientKey: string;
  readonly providers: AssistantProviders;
}

export function assistantStatus(): { enabled: boolean; providers: string[] } {
  const providers = assistantProviders();
  return {
    enabled: providers !== null,
    providers: providers ? providers.chat.map((provider) => provider.name) : [],
  };
}

function requireProviders(): AssistantProviders {
  const providers = assistantProviders();
  if (!providers) {
    throw providerUnavailable('The shopping assistant is not available right now.');
  }
  return providers;
}

/** The conversation, if the caller owns it. Someone else's is indistinguishable from none. */
async function findOwnedConversation(
  conversationId: string,
  userId: string | null,
  guestToken: string | undefined,
) {
  if (userId !== null) {
    return prisma.assistantConversation.findFirst({ where: { id: conversationId, userId } });
  }
  if (!guestToken || !TOKEN_PATTERN.test(guestToken)) {
    return null;
  }
  return prisma.assistantConversation.findFirst({
    where: { id: conversationId, guestTokenHash: hashToken(guestToken), userId: null },
  });
}

async function checkDailyAllowance(userId: string | null, clientKey: string, now: Date) {
  const since = startOfUtcDay(now);

  if (userId !== null) {
    const spent = await prisma.assistantMessage.aggregate({
      where: { createdAt: { gte: since }, conversation: { userId } },
      _sum: { inputTokens: true, outputTokens: true },
    });
    const used = (spent._sum.inputTokens ?? 0) + (spent._sum.outputTokens ?? 0);
    if (used >= env.ASSISTANT_DAILY_TOKEN_BUDGET) {
      throw rateLimited(
        "You've reached today's limit for the shopping assistant. Try again tomorrow.",
      );
    }
    return;
  }

  const sent = await prisma.assistantMessage.count({
    where: { createdAt: { gte: since }, role: 'USER', clientKeyHash: clientKey },
  });
  if (sent >= env.ASSISTANT_GUEST_DAILY_MESSAGES) {
    throw rateLimited(
      "You've reached today's limit for the shopping assistant. Sign in for more, or try again tomorrow.",
    );
  }
}

/**
 * Everything that can refuse a turn, before anything is streamed, so a refusal is an ordinary
 * JSON error: no providers (503), a conversation that is not the caller's (404), a full
 * conversation or a spent allowance (429). Then the customer's message is saved.
 */
export async function prepareTurn(request: TurnRequest, now = new Date()): Promise<PreparedTurn> {
  const providers = requireProviders();
  const clientKey = clientKeyHash(request.ip);

  let conversationId: string | undefined;
  let history: ChatMessage[] = [];

  if (request.conversationId) {
    const conversation = await findOwnedConversation(
      request.conversationId,
      request.userId,
      request.guestToken,
    );
    if (!conversation) {
      throw notFound('That conversation does not exist.');
    }
    if (conversation.messageCount + 2 > MAX_CONVERSATION_MESSAGES) {
      throw rateLimited('This conversation is full. Start a new one to keep chatting.');
    }
    conversationId = conversation.id;
    const earlier = await prisma.assistantMessage.findMany({
      where: { conversationId, errorCode: null },
      orderBy: { createdAt: 'desc' },
      take: HISTORY_MESSAGES,
      select: { role: true, content: true },
    });
    history = earlier
      .reverse()
      .filter((message) => message.content !== '')
      .map((message) =>
        message.role === 'USER'
          ? { role: 'user' as const, content: message.content }
          : { role: 'assistant' as const, content: message.content },
      );
  }

  await checkDailyAllowance(request.userId, clientKey, now);

  let newGuestToken: string | undefined;

  const id = await withTransaction(
    async (tx) => {
      let target = conversationId;
      if (!target) {
        if (request.userId === null) {
          newGuestToken = randomBytes(32).toString('base64url');
        }
        const created = await tx.assistantConversation.create({
          data:
            request.userId === null
              ? { guestTokenHash: hashToken(newGuestToken ?? ''), lastMessageAt: now }
              : { userId: request.userId, lastMessageAt: now },
          select: { id: true },
        });
        target = created.id;
      }

      await tx.assistantMessage.create({
        data: {
          conversationId: target,
          role: 'USER',
          content: request.message,
          clientKeyHash: clientKey,
          createdAt: now,
        },
      });
      await tx.assistantConversation.update({
        where: { id: target },
        data: { messageCount: { increment: 1 }, lastMessageAt: now },
      });
      return target;
    },
    { label: 'assistant.prepareTurn' },
  );

  return {
    conversationId: id,
    newGuestToken,
    history: [...history, { role: 'user', content: request.message }],
    userId: request.userId,
    clientKey,
    providers,
  };
}

function estimateTokens(messages: readonly ChatMessage[], reply: string): TokenUsage {
  const input = messages.reduce(
    (sum, message) => sum + ('content' in message && message.content ? message.content.length : 0),
    0,
  );
  return { inputTokens: Math.ceil(input / 4), outputTokens: Math.ceil(reply.length / 4) };
}

interface TurnRecord {
  provider: string | null;
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  toolNames: string[];
  errorCode: string | null;
}

/**
 * Runs the model and yields what the customer sees. The first event is `meta`, and it is yielded
 * only once a provider has produced something: if every provider fails first, the generator
 * throws `providerUnavailable` before yielding, so the route can still answer 503 as JSON.
 *
 * Fallback (decision 5): a provider failure before any text has reached the customer moves the
 * turn to the next provider, which then serves the rest of it. After text has been sent, a
 * failure ends the turn with an `error` event.
 */
export async function* runTurn(
  turn: PreparedTurn,
  signal?: AbortSignal,
): AsyncGenerator<AssistantEvent, void, undefined> {
  const startedAt = Date.now();
  const settings = await getStoreSettings();
  const tools = toolsFor(turn.userId, { embeddings: turn.providers.embeddings !== null });
  const toolContext = {
    userId: turn.userId,
    embeddings: turn.providers.embeddings,
    currency: env.STORE_CURRENCY,
  };

  const messages: ChatMessage[] = [
    { role: 'system', content: systemPrompt(settings.storeName, turn.userId !== null) },
    ...turn.history,
  ];

  const record: TurnRecord = {
    provider: null,
    model: null,
    inputTokens: 0,
    outputTokens: 0,
    toolNames: [],
    errorCode: null,
  };
  let reply = '';
  let metaSent = false;
  let providerIndex = 0;
  const shownProducts = new Set<string>();

  const meta = (provider: ChatProvider): AssistantEvent => ({
    type: 'meta',
    conversationId: turn.conversationId,
    ...(turn.newGuestToken ? { guestToken: turn.newGuestToken } : {}),
    provider: provider.name,
  });

  try {
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
      const offerTools = round < MAX_TOOL_ROUNDS;
      let calls: readonly ToolCall[] = [];
      let roundText = '';

      // Try providers in order until one streams this round.
      for (;;) {
        const provider = turn.providers.chat[providerIndex];
        if (!provider) {
          throw providerUnavailable('The shopping assistant is not available right now.');
        }

        try {
          let usage: TokenUsage | null = null;
          for await (const event of provider.stream({
            messages,
            tools: offerTools ? tools : [],
            maxTokens: MAX_OUTPUT_TOKENS,
            ...(signal ? { signal } : {}),
          })) {
            if (event.type === 'text') {
              if (!metaSent) {
                metaSent = true;
                yield meta(provider);
              }
              roundText += event.text;
              reply += event.text;
              if (reply.length <= MAX_REPLY_CHARS) {
                yield { type: 'delta', text: event.text };
              }
            } else if (event.type === 'tool_calls') {
              calls = event.calls;
            } else {
              usage = event.usage;
            }
          }
          const counted = usage ?? estimateTokens(messages, roundText);
          record.inputTokens += counted.inputTokens;
          record.outputTokens += counted.outputTokens;
          record.provider = provider.name;
          record.model = provider.model;
          break;
        } catch (error) {
          if (!(error instanceof AssistantProviderUnavailableError)) throw error;
          if (signal?.aborted) throw error;
          logger.warn(
            {
              provider: error.provider,
              failure: error.failure,
              httpStatus: error.httpStatus,
              conversationId: turn.conversationId,
            },
            'Assistant provider failed',
          );
          if (reply !== '' || providerIndex + 1 >= turn.providers.chat.length) {
            throw error;
          }
          providerIndex += 1;
          roundText = '';
          calls = [];
        }
      }

      if (calls.length === 0) {
        break;
      }

      messages.push({
        role: 'assistant',
        content: roundText === '' ? null : roundText,
        toolCalls: calls,
      });

      for (const call of calls) {
        record.toolNames.push(call.name.slice(0, 60));
        const outcome = await runTool(call.name, call.arguments, toolContext);
        messages.push({ role: 'tool', toolCallId: call.id, content: outcome.content });

        const fresh = outcome.products.filter((card) => !shownProducts.has(card.id));
        if (fresh.length > 0 || outcome.sources.length > 0) {
          if (!metaSent) {
            metaSent = true;
            yield meta(turn.providers.chat[providerIndex] as ChatProvider);
          }
        }
        if (fresh.length > 0) {
          for (const card of fresh) shownProducts.add(card.id);
          yield { type: 'products', items: fresh };
        }
        if (outcome.sources.length > 0) {
          yield { type: 'sources', items: outcome.sources };
        }
      }
    }

    if (!metaSent) {
      // The model answered with nothing at all. Say something rather than leave a blank bubble.
      metaSent = true;
      yield meta(turn.providers.chat[providerIndex] as ChatProvider);
    }
    if (reply.trim() === '') {
      reply = "Sorry, I couldn't find an answer to that. The FAQ page may help: /faq";
      yield { type: 'delta', text: reply };
    }
  } catch (error) {
    const unavailable = error instanceof AssistantProviderUnavailableError;
    record.errorCode = signal?.aborted
      ? 'CLIENT_CLOSED'
      : unavailable
        ? 'PROVIDER_UNAVAILABLE'
        : 'INTERNAL_ERROR';
    await saveReply(turn, reply, record, startedAt);

    if (!metaSent) {
      // Nothing reached the customer: let the route answer with a plain JSON error.
      if (unavailable)
        throw providerUnavailable('The shopping assistant is not available right now.');
      throw error;
    }
    if (!signal?.aborted) {
      if (!unavailable)
        logger.error({ err: error, conversationId: turn.conversationId }, 'Assistant turn failed');
      yield {
        type: 'error',
        code: unavailable ? 'PROVIDER_UNAVAILABLE' : 'INTERNAL_ERROR',
        message: 'The assistant stopped before finishing. Please try again.',
      };
    }
    return;
  }

  const messageId = await saveReply(turn, reply, record, startedAt);
  yield {
    type: 'done',
    messageId,
    usage: { inputTokens: record.inputTokens, outputTokens: record.outputTokens },
  };
}

async function saveReply(
  turn: PreparedTurn,
  reply: string,
  record: TurnRecord,
  startedAt: number,
): Promise<string> {
  const now = new Date();
  return withTransaction(
    async (tx) => {
      const message = await tx.assistantMessage.create({
        data: {
          conversationId: turn.conversationId,
          role: 'ASSISTANT',
          content: reply.slice(0, MAX_REPLY_CHARS),
          provider: record.provider,
          model: record.model ? `${record.model} (prompt ${PROMPT_VERSION})`.slice(0, 200) : null,
          inputTokens: record.inputTokens,
          outputTokens: record.outputTokens,
          toolNames: record.toolNames,
          latencyMs: Math.max(0, Date.now() - startedAt),
          errorCode: record.errorCode,
          createdAt: now,
        },
        select: { id: true },
      });
      await tx.assistantConversation.update({
        where: { id: turn.conversationId },
        data: { messageCount: { increment: 1 }, lastMessageAt: now },
      });
      return message.id;
    },
    { label: 'assistant.saveReply' },
  );
}

export interface ConversationView {
  readonly id: string;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
  readonly messages: readonly {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly failed: boolean;
    readonly createdAt: Date;
  }[];
}

/** The owner's view of a conversation, for resuming it. */
export async function getOwnConversation(
  conversationId: string,
  userId: string | null,
  guestToken: string | undefined,
): Promise<ConversationView> {
  const conversation = await findOwnedConversation(conversationId, userId, guestToken);
  if (!conversation) {
    throw notFound('That conversation does not exist.');
  }

  const messages = await prisma.assistantMessage.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    select: { id: true, role: true, content: true, errorCode: true, createdAt: true },
  });

  return {
    id: conversation.id,
    createdAt: conversation.createdAt,
    lastMessageAt: conversation.lastMessageAt,
    messages: messages.map((message) => ({
      id: message.id,
      role: message.role === 'USER' ? 'user' : 'assistant',
      content: message.content,
      failed: message.errorCode !== null,
      createdAt: message.createdAt,
    })),
  };
}
