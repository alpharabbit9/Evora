'use client';

import { useRouter } from 'next/navigation';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { authClient } from '@/lib/auth-client';

/**
 * Ends the session on the server and sends the user to sign-in.
 *
 * `authClient.signOut` posts to `/api/v1/auth/sign-out`, which deletes the session row —
 * not just the cookie — so the token cannot be replayed. `router.refresh()` is what clears
 * the cached Server Component output; without it a back navigation could still paint the
 * signed-in page from cache.
 */
export function SignOutButton() {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  async function onSignOut() {
    setIsPending(true);

    try {
      await authClient.signOut();
      router.push('/sign-in');
      router.refresh();
    } finally {
      // Left pending on success too: the component unmounts on navigation, and re-enabling
      // the button first would let a second click fire against a dead session.
      setIsPending(false);
    }
  }

  return (
    <Button type="button" variant="outline" disabled={isPending} onClick={() => void onSignOut()}>
      {isPending ? 'Signing out…' : 'Sign out'}
    </Button>
  );
}
