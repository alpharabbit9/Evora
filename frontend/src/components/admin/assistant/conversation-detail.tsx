'use client';

import { useAdminAssistantConversation } from '@/lib/admin/api';
import type { AdminAssistantConversationDetail } from '@/lib/admin/types';

import { AdminPageSkeleton } from '../admin-skeleton';
import { AdminPageHeader, AdminQueryState, Badge, formatAdminDateTime } from '../admin-ui';

/**
 * One assistant conversation, read-only (ADR 0025). The text is shown as plain text, never as
 * HTML: it was written by a customer and a model. Each reply shows which provider answered, the
 * tools it used, its cost in tokens and, if it failed, why.
 */
export function ConversationDetailScreen({ conversationId }: { conversationId: string }) {
  const conversation = useAdminAssistantConversation(conversationId);

  return (
    <AdminQueryState
      query={conversation}
      pending={<AdminPageSkeleton />}
      errorTitle="We couldn't load this conversation"
      isEmpty={() => false}
    >
      {(data) => <ConversationDetail conversation={data} />}
    </AdminQueryState>
  );
}

function ConversationDetail({ conversation }: { conversation: AdminAssistantConversationDetail }) {
  const who = conversation.customer ? conversation.customer.email : 'a guest';

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        back={{ href: '/admin/assistant', label: 'Assistant chats' }}
        title="Assistant conversation"
        description={`With ${who}, started ${formatAdminDateTime(conversation.createdAt)}. This view was recorded in the audit log.`}
      />

      <ol className="flex max-w-3xl flex-col gap-4" aria-label="Messages">
        {conversation.messages.map((message) => (
          <li
            key={message.id}
            className={
              message.role === 'user'
                ? 'rounded-lg border border-border bg-card p-4'
                : 'rounded-lg border border-border bg-muted/40 p-4'
            }
          >
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
              <span className="font-medium text-foreground">
                {message.role === 'user' ? 'Customer' : 'Assistant'}
              </span>
              <span>{formatAdminDateTime(message.createdAt)}</span>
              {message.provider ? <Badge>{message.provider}</Badge> : null}
              {message.errorCode ? <Badge tone="destructive">{message.errorCode}</Badge> : null}
            </div>
            <p className="text-sm whitespace-pre-wrap">
              {message.content === '' ? (
                <span className="text-muted-foreground">(no text)</span>
              ) : (
                message.content
              )}
            </p>
            {message.role === 'assistant' ? (
              <p className="mt-2 text-xs text-muted-foreground">
                {message.toolNames.length > 0
                  ? `Tools: ${message.toolNames.join(', ')} · `
                  : 'No tools · '}
                {`${String(message.inputTokens + message.outputTokens)} tokens`}
                {message.latencyMs === null ? '' : ` · ${(message.latencyMs / 1000).toFixed(1)} s`}
                {message.model ? ` · ${message.model}` : ''}
              </p>
            ) : null}
          </li>
        ))}
      </ol>
    </div>
  );
}
