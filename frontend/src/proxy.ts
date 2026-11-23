import { NextResponse, type NextRequest } from 'next/server';

/**
 * Optimistic route guard. In Next.js 16 this file is `proxy.ts`, not `middleware.ts` — the
 * convention was renamed, and the old name is deprecated.
 *
 * It checks only whether a session cookie is *present*, which is all it can do: the cookie
 * is signed and its validity lives in the database, and Next's own guidance is that a proxy
 * "should not be used as a full session management or authorization solution". So this exists
 * for one reason — to send an obviously-anonymous visitor to sign-in without rendering a
 * protected page first. The real check is `SignedInOnly` in each page, which asks the API,
 * and the API refuses the data behind these pages without a session regardless (ADR 0014).
 *
 * The same goes for `/admin`, where the cookie says even less: a customer's session passes here,
 * and it is `AdminOnly` and the API's `requireAdmin` that read the role (architecture.md §6).
 *
 * Deliberately NOT done here: redirecting an apparently-signed-in visitor away from
 * `/sign-in`. With a stale or revoked cookie that would bounce them to `/account`, whose
 * authoritative check would send them straight back here, and the two would redirect each
 * other forever.
 */
export function proxy(request: NextRequest): NextResponse {
  // `__Secure-better-auth.session_token` in production, `better-auth.session_token` in
  // development: Better Auth prefixes the name when secure cookies are on, so match the
  // suffix rather than hard-coding one spelling.
  const hasSessionCookie = request.cookies
    .getAll()
    .some((cookie) => cookie.name.endsWith('better-auth.session_token'));

  if (hasSessionCookie) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const signIn = new URL('/sign-in', request.url);
  signIn.searchParams.set('next', `${pathname}${search}`);

  return NextResponse.redirect(signIn);
}

/** The signed-in-only pages. Each one also gates itself, with `SignedInOnly` or `AdminOnly`. */
export const config = {
  matcher: [
    '/account/:path*',
    '/admin/:path*',
    '/cart/:path*',
    '/checkout/:path*',
    '/orders/:path*',
    '/wishlist/:path*',
  ],
};
