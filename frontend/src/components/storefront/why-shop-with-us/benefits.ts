import { BadgeCheck, CreditCard, RotateCcw, Truck, type LucideIcon } from 'lucide-react';

/**
 * The reasons to shop here, as shown in the home page's "Why shop with us?" band, in display
 * order. Edit the wording here; the component only lays it out.
 *
 * Each line is a promise to customers, so before launch it has to match a decided store
 * policy. Shipping zones and fees, refund eligibility and the payment provider are still open
 * (PRD §9 "Decisions still required"): the 30-day return window in particular is not backed by
 * a policy yet.
 */

export type Benefit = {
  id: string;
  title: string;
  description: string;
  /** Outline icon from `lucide-react`; drawn decoratively, the title carries the meaning. */
  icon: LucideIcon;
};

export const BENEFITS: readonly Benefit[] = [
  {
    id: 'quality',
    title: 'Premium Quality',
    description: 'Only the finest materials and craftsmanship.',
    icon: BadgeCheck,
  },
  {
    id: 'payment',
    title: 'Secure Payment',
    description: 'Shop with confidence using trusted payment methods.',
    icon: CreditCard,
  },
  {
    id: 'shipping',
    title: 'Fast & Reliable Shipping',
    description: 'Get your order delivered on time, every time.',
    icon: Truck,
  },
  {
    id: 'returns',
    title: 'Easy Returns',
    description: 'Hassle-free returns within 30 days.',
    icon: RotateCcw,
  },
];
