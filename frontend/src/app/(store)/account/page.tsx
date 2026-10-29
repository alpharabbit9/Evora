import { redirect } from 'next/navigation';
import { Suspense } from 'react';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { LoadingState } from '@/components/common/loading-state';
import { getSessionState } from '@/lib/server-session';

export const metadata = {
  title: 'Your account',
};

/**
 * Protected page. `src/proxy.ts` already turns away a visitor with no session cookie, but
 * that is an optimistic check on cookie presence only — this is the one that decides, by
 * asking the API whose session the cookie actually is.
 *
 * The session read happens at request time, so with `cacheComponents` enabled it cannot be
 * prerendered into the static shell and must stream in behind a `<Suspense>` boundary.
 */
export default function AccountPage() {
  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 px-4 py-12">
      <h1 className="text-xl font-semibold">Your account</h1>

      <Suspense fallback={<LoadingState label="Loading your account" />}>
        <AccountDetails />
      </Suspense>
    </div>
  );
}

async function AccountDetails() {
  const session = await getSessionState();

  if (session.status === 'anonymous') {
    redirect('/sign-in?next=%2Faccount');
  }

  /**
   * A suspended account holds a valid session that the API refuses. Redirecting to sign-in
   * would not help — signing in succeeds and lands back here — so the state is rendered,
   * with the only useful action: end the session.
   */
  if (session.status === 'blocked') {
    return (
      <div className="flex flex-col items-start gap-4">
        <p role="alert" className="text-sm text-destructive">
          {session.message}
        </p>
        <SignOutButton />
      </div>
    );
  }

  const { user } = session;

  return (
    <div className="flex flex-col gap-6">
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
        <dt className="text-muted-foreground">Name</dt>
        <dd>{user.name}</dd>

        <dt className="text-muted-foreground">Email</dt>
        <dd>{user.email}</dd>

        <dt className="text-muted-foreground">Verified</dt>
        <dd>{user.emailVerified ? 'Yes' : 'No'}</dd>

        {/* Shown for orientation. The server authorizes every request regardless of what
            is rendered here — a role in the UI is not permission. */}
        <dt className="text-muted-foreground">Role</dt>
        <dd>{user.role}</dd>

        <dt className="text-muted-foreground">User ID</dt>
        <dd className="font-mono text-xs">{user.id}</dd>
      </dl>

      <div className="flex items-center gap-3">
        <SignOutButton />
      </div>
    </div>
  );
}
