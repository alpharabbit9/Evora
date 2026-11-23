import type { NextConfig } from 'next';

/**
 * Where product images are served from. The API returns absolute image URLs built from its
 * own MEDIA_PUBLIC_URL; this must name the same origin and path so `next/image` will
 * optimise them. Defaults to the API's development media route.
 */
const mediaUrl = new URL(
  process.env.NEXT_PUBLIC_MEDIA_URL ?? `${process.env.NEXT_PUBLIC_API_URL ?? ''}/media`,
);

/**
 * Next 16 refuses to optimise images whose host resolves to a private address (an SSRF
 * guard). Development media is served by the API on localhost, so the guard is relaxed only
 * when the configured media host is a loopback name — never for a real CDN origin.
 */
const mediaIsLoopback =
  ['localhost', '127.0.0.1', '[::1]'].includes(mediaUrl.hostname) ||
  // `media.localhost` in the staging rehearsal (deploy/staging): loopback in the browser, a
  // container on the private network for the image optimiser. Never a public host.
  mediaUrl.hostname.endsWith('.localhost');

const nextConfig: NextConfig = {
  /**
   * The end-to-end suite (`../e2e`) builds with its own API URL baked in, so it builds into
   * `.next-e2e` rather than overwrite the build `npm run start` serves. Unset everywhere else.
   */
  distDir: process.env.NEXT_DIST_DIR ?? '.next',
  /**
   * The container image (ADR 0024) sets NEXT_OUTPUT=standalone to get a self-contained server
   * (`.next/standalone`) with only the files it needs. Off otherwise, because `next start`, which
   * development and the E2E suite use, does not support standalone output.
   */
  ...(process.env.NEXT_OUTPUT === 'standalone' ? { output: 'standalone' as const } : {}),
  /** Do not advertise the framework (M12 hardening; checked by deploy/smoke/smoke.mjs). */
  poweredByHeader: false,
  /**
   * Baseline hardening headers on every page. HSTS belongs to the TLS edge, which knows the
   * real scheme, not to the app. A Content-Security-Policy is not set yet: Next's inline
   * bootstrap scripts need per-request nonces, which is a change of its own (ADR 0024).
   */
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
  cacheComponents: true,
  partialPrefetching: true,
  images: {
    remotePatterns: [
      {
        protocol: mediaUrl.protocol === 'https:' ? 'https' : 'http',
        hostname: mediaUrl.hostname,
        port: mediaUrl.port,
        pathname: `${mediaUrl.pathname.replace(/\/$/, '')}/**`,
        search: '',
      },
    ],
    dangerouslyAllowLocalIP: mediaIsLoopback,
  },
  /**
   * `/sign-in` and `/sign-up` are aliases of the combined `/auth` page, kept because links,
   * `proxy.ts` and the account page send visitors there. Done here rather than as pages: a
   * page would have to read `searchParams` to carry `?next=` along, and under
   * `cacheComponents` that request data cannot be read outside `<Suspense>` during
   * prerendering. A config redirect answers before any render, and Next passes the request's
   * query through, so `/sign-in?next=/account` lands on `/auth?mode=signin&next=/account`.
   * `/auth` still validates `next` with `safeRedirectPath` before following it.
   *
   * Temporary (307), not permanent: these are app routes, and a cached 308 would outlive any
   * later change to where sign-in lives.
   */
  async redirects() {
    return [
      { source: '/sign-in', destination: '/auth?mode=signin', permanent: false },
      { source: '/sign-up', destination: '/auth?mode=signup', permanent: false },
    ];
  },
  turbopack: {
    rules: {
      '*.css': {
        loaders: ['@tailwindcss/turbopack'],
        as: '*.css',
      },
    },
  },
};

export default nextConfig;
