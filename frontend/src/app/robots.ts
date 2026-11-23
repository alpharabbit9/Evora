import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * `robots.txt` (plan.md 9.3). Crawlers may read the storefront; the admin dashboard, the
 * signed-in areas and the purchase flow are private or per visitor, so they are kept out of
 * the crawl. Those pages also say `noindex` themselves (or redirect to sign-in), which is what
 * actually keeps a page out of results: `Disallow` only stops the crawl.
 *
 * `/search` is crawlable but `noindex` (its own metadata): result pages are not worth indexing,
 * and the crawler must be able to read the page to see that.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: '*',
      allow: '/',
      disallow: [
        '/admin',
        '/account',
        '/auth',
        '/cart',
        '/checkout',
        '/orders',
        '/wishlist',
        '/forgot-password',
        '/reset-password',
      ],
    },
    sitemap: absoluteUrl('/sitemap.xml'),
  };
}
