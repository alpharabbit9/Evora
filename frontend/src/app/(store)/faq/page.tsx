import type { Metadata } from 'next';

import { FaqAccordion } from '@/components/storefront/faq/faq-accordion';
import { FAQS } from '@/components/storefront/faq/faqs';
import { InfoPage } from '@/components/storefront/info/info-page';

const DESCRIPTION = 'Answers to the questions we are asked most.';

export const metadata: Metadata = { title: 'FAQ', description: DESCRIPTION };

/**
 * The same questions as the home page's FAQ section, from the same data (`faqs.ts`), so the
 * two never disagree. Each answer keeps its own "policy to be confirmed" label until the
 * policy behind it is decided (PRD §9).
 */
export default function FaqPage() {
  return (
    <InfoPage
      page="faq"
      eyebrow="Help"
      title="Frequently asked questions"
      description={DESCRIPTION}
      draft="These answers are not final store policy. Shipping, returns and delivery countries are still being decided, and each answer is marked until it is confirmed."
    >
      {/* The body fades in with the page (InfoPage); a second, per-question entrance on top
          of that would only make the answers wait. */}
      <FaqAccordion faqs={FAQS} />
    </InfoPage>
  );
}
