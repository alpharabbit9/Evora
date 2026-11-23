/**
 * Questions for the home page's FAQ section, in display order. Edit the wording here; the
 * component only lays it out.
 *
 * Each answer is a statement of store policy, and none of those policies is decided yet:
 * shipping zones and fees, refund eligibility (including COD), live payment approval and
 * delivery countries are all open in PRD §9 "Decisions still required". So every answer below
 * is a `placeholder`, labelled as such on the page, and says no more than is committed to
 * (cash on delivery plus SSLCOMMERZ, ADR 0019; no raw card data stored).
 *
 * The returns answer repeats the 30-day window from the "Why shop with us?" band
 * (`why-shop-with-us/benefits.ts`) so the page does not contradict itself; that window is not
 * backed by a policy either. When a policy is decided, rewrite its answer to match it exactly
 * and mark it `confirmed`.
 *
 * The home page shows only `confirmed` answers in a production build (ADR 0026); the `/faq`
 * page shows them all under its draft notice.
 */

import type { PolicyBacked } from '@/lib/content-gates';

export type Faq = PolicyBacked & {
  id: string;
  question: string;
  /** Plain text; one paragraph per entry. */
  answer: readonly string[];
};

export const FAQS: readonly Faq[] = [
  {
    id: 'shipping-time',
    question: 'How long does shipping take?',
    answer: [
      'Delivery times and fees depend on your address and the delivery option you choose. Both are shown at checkout, before you pay.',
    ],
    policy: 'placeholder',
  },
  {
    id: 'returns',
    question: 'Can I return or exchange an item?',
    answer: [
      'Returns are accepted within 30 days of delivery.',
      'Full eligibility terms, including exchanges and refunds for cash-on-delivery orders, are still being finalised and will be published before launch.',
    ],
    policy: 'placeholder',
  },
  {
    id: 'payment-methods',
    question: 'What payment methods do you accept?',
    answer: [
      'Cash on delivery, and online payment through SSLCOMMERZ, including bKash, cards and other mobile banking. Payment details go straight to the provider: we never see or store them.',
    ],
    policy: 'placeholder',
  },
  {
    id: 'international',
    question: 'Do you offer international shipping?',
    answer: [
      "We're still confirming which countries we deliver to. The destinations we serve will be listed at checkout.",
    ],
    policy: 'placeholder',
  },
];
