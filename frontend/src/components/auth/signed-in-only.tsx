import { redirect } from 'next/navigation';

import { signInPath } from '@/lib/safe-redirect';
import { getSessionState, type SessionUser } from '@/lib/server-session';

import { SignOutButton } from './sign-out-button';

/**
 * The authoritative gate for a page only a signed-in customer may see: `/account`, `/cart`,
 * `/checkout`, `/orders` and `/wishlist` (ADR 0014). `src/proxy.ts` has already turned away a visitor with no
 * session cookie, but only on cookie presence; this asks the API whose session the cookie
 * actually is, and sends anyone it does not recognise to sign-in with `next` set to `path`.
 *
 * Reads the request's cookies, so with `cacheComponents` it must sit behind a `<Suspense>`
 * boundary — give it a skeleton of the page as the fallback.
 *
 * A suspended account holds a valid session that the API refuses. Redirecting to sign-in
 * would not help — signing in succeeds and lands back here — so that state is rendered, with
 * the only useful action: end the session.
 */
export async function SignedInOnly({
  path,
  children,
}: {
  /** Where to come back to after signing in. */
  path: string;
  children: (user: SessionUser) => React.ReactNode;
}) {
  const session = await getSessionState();

  if (session.status === 'anonymous') {
    redirect(signInPath(path));
  }

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

  return children(session.user);
}
