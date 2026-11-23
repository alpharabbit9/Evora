import type { Metadata } from 'next';

import { PageTransition } from '@/components/layout/page-transition';
import { CampaignBanner } from '@/components/storefront/campaign-banner/campaign-banner';
import { CustomerReviews } from '@/components/storefront/customer-reviews/customer-reviews';
import { DarkEdit } from '@/components/storefront/dark-edit/dark-edit';
import { FashionHeroSlider } from '@/components/storefront/fashion-hero/fashion-hero-slider';
import { Faq } from '@/components/storefront/faq/faq';
import { Newsletter } from '@/components/storefront/newsletter/newsletter';
import { ScrollAway } from '@/components/storefront/scroll-motion';
import { RecentArrivals } from '@/components/storefront/recent-arrivals/recent-arrivals';
import { WhyShopWithUs } from '@/components/storefront/why-shop-with-us/why-shop-with-us';
import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from '@/lib/site';

/**
 * The home page's canonical URL (plan.md 9.2). Its link preview is the layout's: site name and
 * type, and the app-wide `opengraph-image.jpg` / `twitter-image.jpg`, captured from this page's
 * hero; title and description come from the page's own. No `openGraph` here: a page's
 * `openGraph` replaces the layout's whole, image file included.
 */
export const metadata: Metadata = {
  alternates: { canonical: '/' },
};

/**
 * Structured data for search engines (plan.md 9.4): who runs the site, and how to search it,
 * as one JSON-LD graph. `/search?q=` is the storefront's real results page. No logo: the
 * wordmark is set in type, and there is no image of it to point at.
 */
const STRUCTURED_DATA = {
  '@context': 'https://schema.org',
  '@graph': [
    {
      '@type': 'Organization',
      '@id': absoluteUrl('/#organization'),
      name: SITE_NAME,
      url: absoluteUrl('/'),
    },
    {
      '@type': 'WebSite',
      '@id': absoluteUrl('/#website'),
      name: SITE_NAME,
      url: absoluteUrl('/'),
      description: SITE_DESCRIPTION,
      publisher: { '@id': absoluteUrl('/#organization') },
      potentialAction: {
        '@type': 'SearchAction',
        target: {
          '@type': 'EntryPoint',
          urlTemplate: absoluteUrl('/search?q={search_term_string}'),
        },
        'query-input': 'required name=search_term_string',
      },
    },
  ],
};

export default function Home() {
  return (
    <PageTransition>
      <script
        type="application/ld+json"
        // Static data written here, never user input; `<` is escaped anyway, so no value
        // could ever close the script element.
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(STRUCTURED_DATA).replace(/</g, '\\u003c'),
        }}
      />
      {/* The page heading. The hero's oversized word is decorative and each slide carries its
          own h2. */}
      <h1 className="sr-only">EVORA — Modern essentials</h1>
      {/* The hero drifts down inside a clip as it scrolls away, so the sections below slide
          up over it. The sections below reveal on scroll with GSAP ScrollTrigger (ADR 0010). */}
      <ScrollAway>
        <FashionHeroSlider />
      </ScrollAway>
      {/* Chapters alternate light and dark (plan.md §D): the light rail, the dark edit and
          campaign, then reviews, the service strip, the newsletter and the questions. */}
      <RecentArrivals />
      <DarkEdit />
      <CampaignBanner />
      <CustomerReviews />
      <WhyShopWithUs />
      <Newsletter />
      <Faq />
    </PageTransition>
  );
}
