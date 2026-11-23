import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { ConversationDetailScreen } from '@/components/admin/assistant/conversation-detail';

export const metadata: Metadata = { title: 'Assistant conversation' };

export default function AdminAssistantConversationPage({
  params,
}: PageProps<'/admin/assistant/[conversationId]'>) {
  const conversationId = params.then((resolved) => resolved.conversationId);

  return (
    <AdminPage path={conversationId.then((id) => `/admin/assistant/${encodeURIComponent(id)}`)}>
      {conversationId.then((id) => (
        <ConversationDetailScreen conversationId={id} />
      ))}
    </AdminPage>
  );
}
