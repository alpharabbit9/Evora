import { ShieldXIcon } from 'lucide-react';
import { redirect } from 'next/navigation';

import { SignOutButton } from '@/components/auth/sign-out-button';
import { signInPath } from '@/lib/safe-redirect';
import { getSessionState, type SessionUser } from '@/lib/server-session';

/**
 * The server-side role check for the dashboard (architecture.md §6, "As built (admin
 * dashboard)"). `src/proxy.ts` has already turned away a visitor with no session cookie, but it
 * cannot read a role; this asks the API whose session the cookie is and what that account may do.
 *
 * It decides what to render and nothing more: every `/admin` endpoint runs `requireAdmin`, so a
 * customer who got past this page would still be refused the data behind it.
 *
 * Used in the admin layout, for the chrome, and again in every page, because a layout neither
 * re-renders on a client navigation nor stops the page beneath it from running.
 *
 * Reads the request's cookies, so with `cacheComponents` it must sit behind `<Suspense>`.
 * A customer gets a refusal rather than a redirect: nowhere else would explain why, and a
 * suspended account cannot be redirected at all (see `SignedInOnly`).
 */
export async function AdminOnly({
  path,
  children,
  refused,
}: {
  /** Where to come back to after signing in. */
  path: string;
  children: (user: SessionUser) => React.ReactNode;
  /**
   * What to render instead of the refusal. The layout passes the page through, because the page
   * runs its own `AdminOnly` and shows the refusal itself; that way the page segment is always
   * rendered, which Next's instant-navigation check requires, and the dashboard's chrome still
   * never reaches a visitor who is not an administrator.
   */
  refused?: React.ReactNode;
}) {
  const session = await getSessionState();

  if (session.status === 'anonymous') {
    redirect(signInPath(path));
  }

  if (session.status === 'blocked') {
    return refused ?? <AdminRefusal message={session.message} />;
  }

  if (session.user.role !== 'ADMIN' && session.user.role !== 'SUPERADMIN') {
    return refused ?? <AdminRefusal message="This area is for store administrators." />;
  }

  return children(session.user);
}

function AdminRefusal({ message }: { message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 px-6 py-24 text-center">
      <ShieldXIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <h1 className="text-base font-medium">You don&apos;t have access to this page</h1>
        <p role="alert" className="max-w-sm text-sm text-muted-foreground">
          {message}
        </p>
      </div>
      <div className="flex items-center gap-3">
        {/* A plain anchor on purpose, so leaving also clears the router's copy of this refusal. */}
        {/* eslint-disable-next-line @next/next/no-html-link-for-pages -- `Link` would keep that copy. */}
        <a
          href="/"
          className="text-sm underline underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          Back to the store
        </a>
        <SignOutButton />
      </div>
    </div>
  );
}
