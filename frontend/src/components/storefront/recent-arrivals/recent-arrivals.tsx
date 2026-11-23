import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';

import { ArrivalsRail } from './arrivals-rail';

const HEADING_ID = 'recent-arrivals-heading';

/**
 * "Recent Arrivals": the newest pieces hung side-on on a clothes rail, each swinging round to
 * face the front when pointed at (ADR 0027). The pieces are a curated list (`arrivals-data.ts`)
 * with a studio photo from the side and the front; each links to its catalog category.
 *
 * A Server Component for the heading and link; only the rail runs in the browser. The heading
 * row rises in with `RevealGroup`; the garments then slide in along the rod (the rail's own
 * `RevealGroup items="slide"`). GSAP owns only those wrappers' opacity and transform; the
 * garments' sway and turn stay CSS (ADR 0010).
 */
export function RecentArrivals() {
  return (
    <section aria-labelledby={HEADING_ID} className="overflow-hidden bg-background text-foreground">
      <Container className="pt-section-md pb-section-sm">
        <RevealGroup className="mb-8 flex flex-wrap items-end justify-between gap-6 sm:mb-10">
          <RevealItem>
            <SectionHeading id={HEADING_ID} eyebrow="Just landed" title="Recent Arrivals" />
          </RevealItem>
          <RevealItem>
            <Link
              href="/collections/new"
              className="tap-target border-b border-foreground/30 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              Shop new in
            </Link>
          </RevealItem>
        </RevealGroup>
        <ArrivalsRail />
      </Container>
    </section>
  );
}
