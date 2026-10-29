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
