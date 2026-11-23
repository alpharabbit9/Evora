import type { Metadata } from 'next';

import { AdminPage } from '@/components/admin/admin-page';
import { ConversationList } from '@/components/admin/assistant/conversation-list';

export const metadata: Metadata = { title: 'Assistant chats' };

export default function AdminAssistantPage() {
  return (
    <AdminPage path="/admin/assistant">
      <ConversationList />
    </AdminPage>
  );
}
