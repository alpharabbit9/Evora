import { z } from 'zod';

/**
 * Only NEXT_PUBLIC_* variables exist in the browser bundle, and Next inlines them at
 * build time — so they must be referenced literally, not via a dynamic lookup.
 * Nothing secret belongs in this file.
 */
const publicEnvSchema = z.object({
  NEXT_PUBLIC_API_URL: z.url(),
  NEXT_PUBLIC_SITE_URL: z.url().optional(),
});

const parsed = publicEnvSchema.safeParse({
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  // An empty build arg (the Dockerfile's default) counts as unset.
  NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL || undefined,
});

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n');
  throw new Error(`Invalid public environment configuration:\n${issues}`);
}

export const publicEnv = parsed.data;

/**
 * The storefront's own public origin, for the absolute URLs search engines and link previews
 * need: canonical links, Open Graph images, `robots.txt`, the sitemap and the home page's
 * JSON-LD (plan.md Phase 9). Unset, it is the development server's address, which is right only
 * for development: set it in every build that is crawled or shared (docs/runbooks/deploy.md).
 */
export const SITE_URL = (publicEnv.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(
  /\/$/,
  '',
);

/** The API is versioned; keep the prefix in one place (API_SPEC.md §1). */
export const API_BASE_URL = `${publicEnv.NEXT_PUBLIC_API_URL}/api/v1`;

/**
 * Where the Next.js server itself reaches the API (ADR 0024). In production the browser calls
 * the API through the public origin (often the storefront's own host, path-routed to the API),
 * while the server can use the private network instead: `http://api:4000` in a container
 * network, for example. Server-only and optional: not `NEXT_PUBLIC_`, so it never reaches the
 * browser bundle, and unset it falls back to the public URL.
 *
 * On Vercel (ADR 0028) the API is a deployment of its own that `src/proxy.ts` forwards `/api` to
 * (API_PROXY_TARGET). Server Components go to it directly rather than back through the proxy.
 */
const internalApiUrl =
  typeof window === 'undefined'
    ? process.env.API_INTERNAL_URL || process.env.API_PROXY_TARGET || undefined
    : undefined;

export const SERVER_API_BASE_URL = internalApiUrl
  ? `${z.url().parse(internalApiUrl).replace(/\/$/, '')}/api/v1`
  : API_BASE_URL;
