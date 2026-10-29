import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';

import { FaqAccordion } from './faq-accordion';
import { FAQS, type Faq as FaqEntry } from './faqs';

const HEADING_ID = 'faq-heading';

/**
 * Common questions, closing the home page. The heading sits beside the questions from `lg`,
 * and above them below that, where two columns would squeeze the answers.
 *
 * No "View all FAQ" link: there is no FAQ page to send it to yet.
 *
 * A Server Component: only the accordion and the reveal wrapper run in the browser. Renders
 * nothing without questions.
 */
export function Faq({ faqs = FAQS }: { faqs?: readonly FaqEntry[] }) {
  if (faqs.length === 0) return null;

  return (
    <section aria-labelledby={HEADING_ID} className="bg-background text-foreground">
      {/* Little room above: the newsletter section's bottom padding already separates the
          two, and the accordion's own top rule, level with the eyebrow, opens the list. A
          section rule as well would stack two hairlines over the questions. */}
      <div className="mx-auto w-full max-w-[1680px] px-4 pt-[clamp(0.5rem,0.25rem+1vw,1rem)] pb-[clamp(3.5rem,2.5rem+4vw,6.5rem)] sm:px-6 lg:px-10 xl:px-14">
        <RevealGroup className="grid gap-8 sm:gap-10 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.7fr)] lg:gap-16 xl:gap-24">
          <RevealItem>
            <SectionHeading id={HEADING_ID} eyebrow="FAQ" title="Common Questions" />
          </RevealItem>

          <FaqAccordion faqs={faqs} />
        </RevealGroup>
      </div>
    </section>
  );
}
