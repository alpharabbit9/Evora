import Link from 'next/link';
import { Suspense } from 'react';

import {
  ACCOUNT_COLUMNS,
  ACCOUNT_FRAME,
  AccountDetailsSkeleton,
} from '@/components/account/account-skeleton';
import { AddressBook } from '@/components/account/address-book';
import { ChangePasswordSection } from '@/components/account/change-password-section';
import { ProfileSection } from '@/components/account/profile-section';
import { SessionsSection } from '@/components/account/sessions-section';
import { SignedInOnly } from '@/components/auth/signed-in-only';
import { SignOutButton } from '@/components/auth/sign-out-button';
import { PageHeader } from '@/components/layout/page-header';
import { PageTransition } from '@/components/layout/page-transition';
import { SectionIndex } from '@/components/layout/section-index';
import { OrderHistory } from '@/components/orders/order-history';
import { buttonVariants } from '@/components/ui/button';
import type { SessionUser } from '@/lib/server-session';

export const metadata = {
  title: 'Your account',
};

/** The page's sections, by their headings' ids, for the index beside them. */
const SECTIONS = [
  { href: '#account-profile', label: 'Profile' },
  { href: '#account-addresses', label: 'Addresses' },
  { href: '#account-password', label: 'Password' },
  { href: '#account-sessions', label: 'Devices' },
  { href: '#your-orders', label: 'Orders' },
] as const;

/**
 * Protected page. `src/proxy.ts` already turns away a visitor with no session cookie, but
 * that is an optimistic check on cookie presence only — `SignedInOnly` is the one that
 * decides, by asking the API whose session the cookie actually is.
 *
 * The session read happens at request time, so with `cacheComponents` enabled it cannot be
 * prerendered into the static shell and must stream in behind a `<Suspense>` boundary. The
 * header and the section index are static, so they are in the shell.
 */
export default function AccountPage() {
  return (
    <PageTransition>
      <div className={ACCOUNT_FRAME}>
        <PageHeader eyebrow="Account" title="Your account" />

        <div className={ACCOUNT_COLUMNS}>
          <SectionIndex
            label="On this page"
            numbered
            items={SECTIONS}
            className="hidden lg:sticky lg:top-28 lg:block lg:self-start"
          />
          <Suspense fallback={<AccountDetailsSkeleton />}>
            <SignedInOnly path="/account">{(user) => <AccountDetails user={user} />}</SignedInOnly>
          </Suspense>
        </div>
      </div>
    </PageTransition>
  );
}

function AccountDetails({ user }: { user: SessionUser }) {
  return (
    <div className="flex flex-col gap-12">
      <ProfileSection name={user.name} email={user.email} emailVerified={user.emailVerified} />
      <AddressBook />
      <ChangePasswordSection />
      <SessionsSection />

      <div className="border-t border-border pt-8">
        <OrderHistory />
      </div>

      <div className="flex flex-wrap items-center gap-3 border-t border-border pt-8">
        {/* Navigation only: `/admin` checks the role itself, and the API authorizes every
            request whatever is rendered here. */}
        {user.role === 'CUSTOMER' ? null : (
          <Link href="/admin" className={buttonVariants({ variant: 'outline' })}>
            Admin dashboard
          </Link>
        )}
        <SignOutButton />
      </div>
    </div>
  );
}
