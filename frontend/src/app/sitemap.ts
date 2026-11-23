import type { MetadataRoute } from 'next';

import { absoluteUrl } from '@/lib/site';

/**
 * The public pages a search engine should know about (plan.md 9.3): the home page, the shop
 * and its collections, and the store's information pages. Product pages are not listed yet
 * (the plan leaves them for later); crawlers still reach them through the shop's links.
 *
 * Static, so no `lastModified`: a date that never changes would tell crawlers nothing true.
 */
const PAGES: readonly {
  path: string;
  changeFrequency: NonNullable<MetadataRoute.Sitemap[number]['changeFrequency']>;
  priority: number;
}[] = [
  { path: '/', changeFrequency: 'daily', priority: 1 },
  { path: '/shop', changeFrequency: 'daily', priority: 0.9 },
  { path: '/collections/new', changeFrequency: 'daily', priority: 0.8 },
  { path: '/collections/men', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/collections/women', changeFrequency: 'weekly', priority: 0.8 },
  { path: '/faq', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/shipping', changeFrequency: 'monthly', priority: 0.4 },
  { path: '/privacy', changeFrequency: 'yearly', priority: 0.2 },
  { path: '/terms', changeFrequency: 'yearly', priority: 0.2 },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.map(({ path, changeFrequency, priority }) => ({
    url: absoluteUrl(path),
    changeFrequency,
    priority,
  }));
}
