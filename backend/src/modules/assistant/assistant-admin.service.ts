import type { Prisma } from '@prisma/client';

import { notFound } from '../../http/errors.js';
import { type Pagination, toSkipTake } from '../../http/schemas.js';
import { prisma } from '../../lib/prisma.js';
import { withTransaction } from '../../lib/transaction.js';
import type { AdminActionContext } from '../admin/customers.service.js';
import { AuditAction, recordAudit } from '../audit/audit.service.js';

/**
 * Read-only review of assistant conversations for administrators (ADR 0025, decision 8): which
 * chats failed, which provider answered, what it cost. The list shows no chat text and is not
 * audited; opening a conversation shows what a customer wrote, so every opening writes an audit
 * row in the same transaction as the read.
 */

export interface AdminConversationFilters {
  readonly failedOnly?: boolean;
  readonly owner?: 'guest' | 'customer';
}

export interface AdminConversationSummary {
  readonly id: string;
  readonly owner: 'guest' | 'customer';
  readonly customer: { readonly id: string; readonly email: string } | null;
  readonly messageCount: number;
  readonly failedReplies: number;
  readonly tokens: number;
  readonly createdAt: Date;
  readonly lastMessageAt: Date;
}

export interface AdminConversationDetail extends Omit<AdminConversationSummary, 'tokens'> {
  readonly messages: readonly {
    readonly id: string;
    readonly role: 'user' | 'assistant';
    readonly content: string;
    readonly provider: string | null;
    readonly model: string | null;
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly toolNames: readonly string[];
    readonly latencyMs: number | null;
    readonly errorCode: string | null;
    readonly createdAt: Date;
  }[];
}

function whereOf(filters: AdminConversationFilters): Prisma.AssistantConversationWhereInput {
  return {
    ...(filters.owner === 'guest' ? { userId: null } : {}),
    ...(filters.owner === 'customer' ? { userId: { not: null } } : {}),
    ...(filters.failedOnly ? { messages: { some: { errorCode: { not: null } } } } : {}),
  };
}

export async function listConversationsForAdmin(
  pagination: Pagination,
  filters: AdminConversationFilters,
): Promise<{ items: AdminConversationSummary[]; total: number }> {
  const { skip, take } = toSkipTake(pagination);
  const where = whereOf(filters);

  const [rows, total] = await Promise.all([
    prisma.assistantConversation.findMany({
      where,
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
      skip,
      take,
      select: {
        id: true,
        userId: true,
        messageCount: true,
        createdAt: true,
        lastMessageAt: true,
        user: { select: { id: true, email: true } },
      },
    }),
    prisma.assistantConversation.count({ where }),
  ]);

  const ids = rows.map((row) => row.id);
  const [failures, usage] = await Promise.all([
    prisma.assistantMessage.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: ids }, errorCode: { not: null } },
      _count: { _all: true },
    }),
    prisma.assistantMessage.groupBy({
      by: ['conversationId'],
      where: { conversationId: { in: ids } },
      _sum: { inputTokens: true, outputTokens: true },
    }),
  ]);
  const failedBy = new Map(failures.map((row) => [row.conversationId, row._count._all]));
  const tokensBy = new Map(
    usage.map((row) => [
      row.conversationId,
      (row._sum.inputTokens ?? 0) + (row._sum.outputTokens ?? 0),
    ]),
  );

  return {
    total,
    items: rows.map((row) => ({
      id: row.id,
      owner: row.userId === null ? 'guest' : 'customer',
      customer: row.user,
      messageCount: row.messageCount,
      failedReplies: failedBy.get(row.id) ?? 0,
      tokens: tokensBy.get(row.id) ?? 0,
      createdAt: row.createdAt,
      lastMessageAt: row.lastMessageAt,
    })),
  };
}

export async function getConversationForAdmin(
  conversationId: string,
  context: AdminActionContext,
): Promise<AdminConversationDetail> {
  return withTransaction(
    async (tx) => {
      const row = await tx.assistantConversation.findUnique({
        where: { id: conversationId },
        select: {
          id: true,
          userId: true,
          messageCount: true,
          createdAt: true,
          lastMessageAt: true,
          user: { select: { id: true, email: true } },
          messages: {
            orderBy: { createdAt: 'asc' },
            select: {
              id: true,
              role: true,
              content: true,
              provider: true,
              model: true,
              inputTokens: true,
              outputTokens: true,
              toolNames: true,
              latencyMs: true,
              errorCode: true,
              createdAt: true,
            },
          },
        },
      });

      if (!row) {
        throw notFound('That conversation does not exist.');
      }

      await recordAudit(tx, {
        action: AuditAction.ASSISTANT_CONVERSATION_VIEWED,
        entityType: 'assistant_conversation',
        entityId: row.id,
        actor: context.actor,
        ...(context.ipAddress === undefined ? {} : { ipAddress: context.ipAddress }),
        ...(context.requestId === undefined ? {} : { requestId: context.requestId }),
      });

      return {
        id: row.id,
        owner: row.userId === null ? 'guest' : 'customer',
        customer: row.user,
        messageCount: row.messageCount,
        failedReplies: row.messages.filter((message) => message.errorCode !== null).length,
        createdAt: row.createdAt,
        lastMessageAt: row.lastMessageAt,
        messages: row.messages.map((message) => ({
          ...message,
          role: message.role === 'USER' ? 'user' : 'assistant',
        })),
      };
    },
    { label: 'assistant.adminView' },
  );
}
