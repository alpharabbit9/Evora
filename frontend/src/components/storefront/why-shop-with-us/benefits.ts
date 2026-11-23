import { BadgeCheck, CreditCard, RotateCcw, Truck, type LucideIcon } from 'lucide-react';

import type { PolicyBacked } from '@/lib/content-gates';

/**
 * The reasons to shop here, as shown in the home page's service strip and beside "Add to bag"
 * on the product page, in display order. Edit the wording here; the components only
 * lay it out.
 *
 * Each line is a promise to customers, so it has to match a decided store policy before a
 * customer sees it. Shipping zones and fees, delivery times and refund eligibility are still
 * open (PRD §9 "Decisions still required"): the 30-day return window in particular is not backed
 * by a policy yet. Those lines are `placeholder` and a production build leaves them out
 * (`visiblePolicyContent`, ADR 0026). Payment is decided (cash on delivery and SSLCOMMERZ,
 * ADR 0019); quality is brand copy rather than a policy.
 *
 * When a policy is decided, rewrite its line to match it exactly and mark it `confirmed`. The FAQ
 * (`faq/faqs.ts`) repeats the returns window, so change both together.
 */

export type Benefit = PolicyBacked & {
  id: string;
  title: string;
  description: string;
  /**
   * Outline icon from `lucide-react`, for the product page's promise row; drawn decoratively,
   * the title carries the meaning. The home page's service strip numbers the promises instead.
   */
  icon: LucideIcon;
};

export const BENEFITS: readonly Benefit[] = [
  {
    id: 'quality',
    title: 'Premium Quality',
    description: 'Only the finest materials and craftsmanship.',
    icon: BadgeCheck,
    policy: 'confirmed',
  },
  {
    id: 'payment',
    title: 'Secure Payment',
    description: 'Shop with confidence using trusted payment methods.',
    icon: CreditCard,
    policy: 'confirmed',
  },
  {
    id: 'shipping',
    title: 'Fast & Reliable Shipping',
    description: 'Get your order delivered on time, every time.',
    icon: Truck,
    policy: 'placeholder',
  },
  {
    id: 'returns',
    title: 'Easy Returns',
    description: 'Hassle-free returns within 30 days.',
    icon: RotateCcw,
    policy: 'placeholder',
  },
];
