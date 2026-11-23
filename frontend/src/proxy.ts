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
  if (request.nextUrl.pathname.startsWith('/api/')) {
    return forwardApi(request);
  }

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

/**
 * The API under this storefront's own host (ADR 0024, ADR 0028).
 *
 * On Vercel the storefront and the API are separate deployments on two `*.vercel.app` hosts,
 * which can never share a cookie (vercel.app is a public suffix). So the browser only ever talks
 * to this host: `/api/*` is forwarded here to API_PROXY_TARGET, the API deployment, and the
 * session cookie the API sets lands on the storefront's host, where `proxy()` above and the
 * Server Components can read it. With API_PROXY_TARGET unset (local development, or an edge that
 * routes `/api` itself, as in deploy/staging) nothing is forwarded.
 *
 * The API would otherwise see this server's address on every request, so the visitor's address,
 * as this platform's edge reported it, goes along with API_PROXY_SECRET, which the API checks
 * before believing it (backend/src/http/client-ip.ts). Only on Vercel, whose edge overwrites
 * `x-real-ip`/`x-forwarded-for`; elsewhere a visitor could write those headers themselves.
 */
const PROXY_SECRET_HEADER = 'x-commercecore-proxy-secret';
const PROXY_CLIENT_IP_HEADER = 'x-commercecore-client-ip';

let apiTarget: URL | null | undefined;

function apiProxyTarget(): URL | null {
  if (apiTarget !== undefined) return apiTarget;
  const value = process.env.API_PROXY_TARGET?.trim();
  // A malformed value throws here, on the first /api request, rather than proxying somewhere odd.
  apiTarget = value ? new URL(value) : null;
  return apiTarget;
}

function visitorAddress(request: NextRequest): string | undefined {
  if (process.env.VERCEL !== '1') return undefined;
  const address =
    request.headers.get('x-real-ip') ?? request.headers.get('x-forwarded-for')?.split(',')[0];
  return address?.trim() || undefined;
}

function forwardApi(request: NextRequest): NextResponse {
  const target = apiProxyTarget();
  if (!target) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;
  const destination = new URL(`${pathname}${search}`, target);

  const headers = new Headers(request.headers);
  // The next hop's Host is the API's, which the platform sets from the destination.
  headers.delete('host');
  // Only this server may set these; a browser's own copies are dropped.
  headers.delete(PROXY_SECRET_HEADER);
  headers.delete(PROXY_CLIENT_IP_HEADER);

  const secret = process.env.API_PROXY_SECRET?.trim();
  const address = visitorAddress(request);
  if (secret && address) {
    headers.set(PROXY_SECRET_HEADER, secret);
    headers.set(PROXY_CLIENT_IP_HEADER, address);
  }

  return NextResponse.rewrite(destination, { request: { headers } });
}

/**
 * The signed-in-only pages, each of which also gates itself with `SignedInOnly` or `AdminOnly`,
 * and `/api`, which is forwarded to the API when API_PROXY_TARGET is set.
 */
export const config = {
  matcher: [
    '/api/:path*',
    '/account/:path*',
    '/admin/:path*',
    '/cart/:path*',
    '/checkout/:path*',
    '/orders/:path*',
    '/wishlist/:path*',
  ],
};
