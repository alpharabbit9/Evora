/**
 * The storefront's navigation, shared by the header, its menu panel and the footer, so the three
 * never disagree. Every href must be a page that exists: Kids and Beauty have no catalog behind
 * them, and About, Journal, Careers, Contact, Size guide and Accessibility have nothing written
 * or decided yet. Add each back with its page.
 */

export type NavLink = {
  readonly label: string;
  readonly href: string;
};

/** The header's inline links (desktop) and the core of every "Shop" list. */
export const SHOP_LINKS: readonly NavLink[] = [
  { label: 'Men', href: '/collections/men' },
  { label: 'Women', href: '/collections/women' },
  { label: 'Accessories', href: '/shop?category=accessories' },
  { label: 'Shop all', href: '/shop' },
];

export const NEW_ARRIVALS_LINK: NavLink = { label: 'New arrivals', href: '/collections/new' };

export const SIGNED_OUT_LINKS: readonly NavLink[] = [
  { label: 'Sign in', href: '/sign-in' },
  { label: 'Create account', href: '/sign-up' },
  { label: 'Wishlist', href: '/wishlist' },
];

export const SIGNED_IN_LINKS: readonly NavLink[] = [
  { label: 'My account', href: '/account' },
  { label: 'Wishlist', href: '/wishlist' },
];

export const HELP_LINKS: readonly NavLink[] = [
  { label: 'Shipping & returns', href: '/shipping' },
  { label: 'FAQ', href: '/faq' },
];

/**
 * Which of `links` is the page being viewed, if any. Paths must match exactly; when several
 * links share a path (`/shop` and `/shop?category=accessories`), the one whose `category`
 * matches wins, and a link without a category takes any other category, so "Shop all" stays
 * current while browsing the shop filtered to jackets.
 */
export function currentLinkHref(
  links: readonly NavLink[],
  pathname: string,
  category: string | null,
): string | null {
  const samePath = links.filter((link) => new URL(link.href, 'http://x').pathname === pathname);
  const exact = samePath.find(
    (link) => new URL(link.href, 'http://x').searchParams.get('category') === category,
  );
  if (exact) return exact.href;
  const general = samePath.find(
    (link) => !new URL(link.href, 'http://x').searchParams.has('category'),
  );
  return general?.href ?? null;
}
