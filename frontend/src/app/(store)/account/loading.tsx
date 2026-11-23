import { AccountPageSkeleton } from '@/components/account/account-skeleton';
import { PageTransition } from '@/components/layout/page-transition';

export default function AccountLoading() {
  return (
    <PageTransition>
      <AccountPageSkeleton />
    </PageTransition>
  );
}
