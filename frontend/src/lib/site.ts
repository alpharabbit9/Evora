import { SITE_URL } from '@/lib/env';

/**
 * The store's name and one-line description, shared by the page titles, link previews and the
 * home page's structured data (plan.md Phase 9), so they never disagree.
 */
export const SITE_NAME = 'EVORA';
export const SITE_TITLE = 'EVORA — Modern essentials';
export const SITE_DESCRIPTION =
  'Considered clothing and objects for a slower, more deliberate everyday.';

/** Absolute URL of a path on this storefront (`/shop` → `https://…/shop`). */
export function absoluteUrl(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`;
}
