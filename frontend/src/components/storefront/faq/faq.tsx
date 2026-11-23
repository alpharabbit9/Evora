import { ArrowRight } from 'lucide-react';
import Link from 'next/link';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { visiblePolicyContent } from '@/lib/content-gates';

import { FaqAccordion } from './faq-accordion';
import { FAQS, type Faq as FaqEntry } from './faqs';

const HEADING_ID = 'faq-heading';

/**
 * Common questions, closing the home page. The heading sits beside the questions from `lg`,
 * and above them below that, where two columns would squeeze the answers.
 *
 * The same questions are on the `/faq` page, from the same data. Here, a production build shows
 * only answers that match a decided policy (ADR 0026); the section renders nothing when none do.
 *
 * A Server Component: only the accordion and the reveal wrapper run in the browser.
 */
export function Faq({ faqs = FAQS }: { faqs?: readonly FaqEntry[] }) {
  const visible = visiblePolicyContent(faqs);
  if (visible.length === 0) return null;

  return (
    <section aria-labelledby={HEADING_ID} className="bg-background text-foreground">
      {/* Little room above: the section before it already ends in its own bottom padding, and
          the accordion's own top rule, level with the eyebrow, opens the list. A section rule
          as well would stack two hairlines over the questions. */}
      <Container className="pt-section-xs pb-section-lg">
        {/* `items={false}`: only the heading's mask and rule move; the questions are simply
            there (plan.md Phase 5). */}
        <RevealGroup
          items={false}
          className="grid gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16 xl:gap-24"
        >
          <RevealItem className="flex flex-col items-start gap-6">
            <SectionHeading id={HEADING_ID} eyebrow="FAQ" title="Common Questions" />
            <Link
              href="/faq"
              className="group inline-flex items-center gap-2.5 border-b border-foreground/25 pb-1.5 text-[10px] font-semibold tracking-[0.24em] uppercase transition-colors hover:border-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
            >
              All questions
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.5}
                className="size-3.5 transition-transform duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:translate-x-1 motion-reduce:transition-none"
              />
            </Link>
          </RevealItem>

          <FaqAccordion faqs={visible} />
        </RevealGroup>
      </Container>
    </section>
  );
}
