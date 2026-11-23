/**
 * The deployment shapes the session cookie can work in (ADR 0024).
 *
 * The API sets the session cookie, and the storefront reads it too: `frontend/src/proxy.ts`
 * looks for it before rendering a protected page, and Server Components forward it to `/me`.
 * A browser sends a cookie only to the host that set it, or to every host under the `Domain`
 * it names. So the storefront and the API must share a host (the API path-routed under
 * `/api`), or share a parent domain named in AUTH_COOKIE_DOMAIN. With two unrelated domains,
 * sign-in succeeds and every protected page sends the customer back to sign-in.
 *
 * Production refuses to boot in that shape rather than ship that loop.
 */

export interface CookieTopology {
  readonly frontendOrigin: string;
  readonly authUrl: string;
  /** e.g. `example.com` when the storefront is `shop.example.com` and the API `api.example.com`. */
  readonly cookieDomain?: string | undefined;
}

/** Hosts where browsers treat plain HTTP as a secure context (a local production rehearsal). */
export function isLoopbackHost(host: string): boolean {
  return (
    host === 'localhost' || host === '127.0.0.1' || host === '[::1]' || host.endsWith('.localhost')
  );
}

function within(host: string, domain: string): boolean {
  return host === domain || host.endsWith(`.${domain}`);
}

/** Why this shape cannot carry the session cookie, or `null` when it can. */
export function cookieTopologyProblem(topology: CookieTopology): string | null {
  const frontend = new URL(topology.frontendOrigin);
  const api = new URL(topology.authUrl);

  for (const [name, url] of [
    ['FRONTEND_ORIGIN', frontend],
    ['BETTER_AUTH_URL', api],
  ] as const) {
    if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
      return `${name} must use https in production: the session cookie is Secure`;
    }
  }

  const domain = topology.cookieDomain?.trim().replace(/^\./, '').toLowerCase();

  if (domain) {
    if (!within(frontend.hostname, domain) || !within(api.hostname, domain)) {
      return (
        `AUTH_COOKIE_DOMAIN "${domain}" must contain both the storefront host ` +
        `(${frontend.hostname}) and the API host (${api.hostname})`
      );
    }
    return null;
  }

  if (frontend.hostname !== api.hostname) {
    return (
      `The storefront (${frontend.hostname}) and the API (${api.hostname}) are on different ` +
      'hosts, so the storefront would never see the session cookie. Serve the API under the ' +
      "storefront's host (path /api), or set AUTH_COOKIE_DOMAIN to their shared parent domain"
    );
  }

  return null;
}
