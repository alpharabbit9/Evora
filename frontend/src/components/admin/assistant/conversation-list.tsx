'use client';

import { MessageCircleIcon } from 'lucide-react';
import Link from 'next/link';

import { EmptyState } from '@/components/common/empty-state';
import { ADMIN_PAGE_SIZE, useAdminAssistantConversations } from '@/lib/admin/api';
import { useListParams } from '@/lib/admin/use-list-params';

import { AdminRowsSkeleton } from '../admin-skeleton';
import {
  AdminPageHeader,
  AdminPagination,
  AdminQueryState,
  Badge,
  FilterBar,
  FilterSelect,
  TBODY_ROW,
  TD,
  TH,
  THEAD_ROW,
  TableFrame,
  focusRing,
  formatAdminDateTime,
} from '../admin-ui';

const OWNER_LABEL = { guest: 'Guest', customer: 'Customer' } as const;
const SHOW_LABEL = { true: 'With failed replies' } as const;
const OWNERS = Object.keys(OWNER_LABEL) as (keyof typeof OWNER_LABEL)[];

/**
 * Shopping assistant conversations (ADR 0025), newest first, for spotting failures and cost. The
 * list carries no chat text. Opening one shows it and is recorded in the audit log, so the page
 * says so before anyone clicks.
 */
export function ConversationList() {
  const params = useListParams();
  const filters = {
    page: params.page,
    pageSize: ADMIN_PAGE_SIZE,
    owner: params.getOneOf('owner', OWNERS),
    failed: params.getOneOf('failed', ['true'] as const),
  };
  const conversations = useAdminAssistantConversations(filters);

  return (
    <div className="flex flex-col gap-6">
      <AdminPageHeader
        title="Assistant chats"
        description="Conversations with the shopping assistant, kept for 30 days after their last message. Opening one shows what the customer wrote and is recorded in the audit log."
      />

      <FilterBar>
        <FilterSelect
          label="Who"
          value={filters.owner}
          onChange={(owner) => {
            params.set({ owner });
          }}
          options={OWNERS.map((value) => ({ value, label: OWNER_LABEL[value] }))}
        />
        <FilterSelect
          label="Show"
          value={filters.failed}
          onChange={(failed) => {
            params.set({ failed });
          }}
          options={[{ value: 'true', label: SHOW_LABEL.true }]}
        />
      </FilterBar>

      <AdminQueryState
        query={conversations}
        pending={<AdminRowsSkeleton />}
        errorTitle="We couldn't load conversations"
        isEmpty={(page) => page.items.length === 0}
        empty={
          <EmptyState
            icon={<MessageCircleIcon className="size-6" strokeWidth={1.25} />}
            title={
              filters.owner || filters.failed ? 'No conversations match' : 'No conversations yet'
            }
          />
        }
      >
        {(page) => (
          <div className="flex flex-col gap-3">
            <TableFrame label="Assistant conversations" stale={conversations.isPlaceholderData}>
              <thead>
                <tr className={THEAD_ROW}>
                  <th scope="col" className={TH}>
                    Last message
                  </th>
                  <th scope="col" className={TH}>
                    Who
                  </th>
                  <th scope="col" className={TH}>
                    Messages
                  </th>
                  <th scope="col" className={TH}>
                    Failed replies
                  </th>
                  <th scope="col" className={TH}>
                    Tokens
                  </th>
                  <th scope="col" className={TH}>
                    <span className="sr-only">Open</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {page.items.map((conversation) => (
                  <tr key={conversation.id} className={TBODY_ROW}>
                    <td className={`${TD} whitespace-nowrap`}>
                      {formatAdminDateTime(conversation.lastMessageAt)}
                    </td>
                    <td className={TD}>
                      {conversation.customer ? conversation.customer.email : OWNER_LABEL.guest}
                    </td>
                    <td className={`${TD} tabular-nums`}>{conversation.messageCount}</td>
                    <td className={TD}>
                      {conversation.failedReplies > 0 ? (
                        <Badge tone="warning">{conversation.failedReplies}</Badge>
                      ) : (
                        <span className="text-muted-foreground">0</span>
                      )}
                    </td>
                    <td className={`${TD} text-muted-foreground tabular-nums`}>
                      {conversation.tokens.toLocaleString('en-US')}
                    </td>
                    <td className={`${TD} text-right`}>
                      <Link
                        href={`/admin/assistant/${encodeURIComponent(conversation.id)}`}
                        className={`text-sm underline underline-offset-2 ${focusRing}`}
                      >
                        Open
                        <span className="sr-only">
                          {' '}
                          conversation from {formatAdminDateTime(conversation.lastMessageAt)}
                        </span>
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </TableFrame>
            <AdminPagination
              params={params}
              pageSize={ADMIN_PAGE_SIZE}
              total={page.total}
              noun="conversations"
            />
          </div>
        )}
      </AdminQueryState>
    </div>
  );
}
