import 'server-only';

import { cookies } from 'next/headers';

import { apiGet } from './api-client';
import { ApiErrorCode, isApiError } from './api-error';

/**
 * Reads the signed-in user on the server, by asking the API who the request's cookie
 * belongs to.
 *
 * This is the authoritative check. `src/proxy.ts` also looks at the request, but only for
 * the presence of a cookie — it cannot tell a valid session from an expired or revoked one,
 * and Next's own guidance is that proxy checks are optimistic and not an authorization
 * mechanism. Anything that must actually be protected calls this.
 *
 * `credentials: 'include'` means nothing on the server, so the incoming cookie is forwarded
 * explicitly. The read is never cached: it is per-user by definition
 * (architecture.md §10 — never cache personalised data).
 *
 * Note for callers: with `cacheComponents` enabled, `cookies()` may only be read inside a
 * `<Suspense>` boundary. A component calling this must sit behind one.
 */
export interface SessionUser {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly emailVerified: boolean;
  readonly image: string | null;
  /** Server-owned. Useful for deciding what to render; never for deciding what to allow. */
  readonly role: 'CUSTOMER' | 'ADMIN' | 'SUPERADMIN';
  readonly status: 'ACTIVE' | 'SUSPENDED';
  readonly createdAt: string;
}

/**
 * Three outcomes, not two. `blocked` is separate from `anonymous` because a suspended
 * account holds a *valid* session that the API refuses with 403: treating that as anonymous
 * would bounce the user to sign-in, where signing in succeeds, which sends them back to the
 * protected page — a redirect loop. It has to be rendered, not redirected.
 */
export type SessionState =
  | { readonly status: 'anonymous' }
  | { readonly status: 'blocked'; readonly message: string }
  | { readonly status: 'authenticated'; readonly user: SessionUser };

export async function getSessionState(): Promise<SessionState> {
  const cookie = (await cookies()).toString();

  // No cookie at all: skip the round trip, the answer cannot be anything else.
  if (!cookie) {
    return { status: 'anonymous' };
  }

  try {
    const user = await apiGet<SessionUser>('/me', { headers: { cookie } });
    return { status: 'authenticated', user };
  } catch (error) {
    if (!isApiError(error)) {
      throw error;
    }

    if (error.code === ApiErrorCode.UNAUTHENTICATED) {
      return { status: 'anonymous' };
    }

    if (error.code === ApiErrorCode.FORBIDDEN) {
      return { status: 'blocked', message: error.message };
    }

    // A network failure or a 500 is not "signed out" — let it reach an error boundary
    // rather than quietly logging the user out over an API outage.
    throw error;
  }
}
