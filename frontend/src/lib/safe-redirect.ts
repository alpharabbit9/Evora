/**
 * Where to send someone after they sign in.
 *
 * Only a path on this site is accepted. An attacker-supplied
 * `?next=https://evil.example` would otherwise turn the sign-in page into an open
 * redirect — a convincing phishing step, because the link genuinely starts on this
 * domain. `//evil.example` is a protocol-relative URL that browsers treat as absolute,
 * hence the second check.
 *
 * This lives apart from `server-session.ts` because the sign-in form is a Client Component
 * and that module is `server-only`.
 */
export function safeRedirectPath(value: string | null | undefined, fallback = '/account'): string {
  if (!value || !value.startsWith('/') || value.startsWith('//')) {
    return fallback;
  }

  return value;
}

/**
 * The sign-in page, set to come back to `next` once the visitor has signed in or created an
 * account. Used by every route and action that needs a session (ADR 0014), so they all
 * return the visitor to where they were.
 */
export function signInPath(next: string): string {
  return `/sign-in?${new URLSearchParams({ next: safeRedirectPath(next, '/') }).toString()}`;
}
