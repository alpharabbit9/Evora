/**
 * Testimonials for the home page's "What our customers say" section, in display order.
 *
 * There are no real reviews yet: the `Review` model is deliberately not built (PRD §4 marks
 * verified-purchase reviews optional; see `backend/prisma/schema.prisma`). Until it is, the
 * entries below are samples written for the prototype. While any are shown, the section
 * carries a note saying so, and the type below makes it impossible to mark one as a verified
 * purchase.
 *
 * To go live, replace them with `customer` entries — from the reviews API once it exists —
 * and never with invented text.
 *
 * Avatars: a card shows the reviewer's own photo only when they supplied it (and consented to
 * it being shown); otherwise their initials. Never a stock portrait: a recognisable stranger
 * beside a quote presents that person as endorsing the store, which neither the Unsplash nor
 * the Pexels licence allows. The samples therefore have none. (The stock shots they used to
 * carry, under `public/images/homepage/reviews/`, are no longer used here. Keep the folder:
 * the E2E fixture, `backend/scripts/e2e/prepare.ts`, copies one as its test product photo.)
 *
 * A production build shows only `customer` entries (ADR 0026): the samples are for development
 * and staging review.
 */

type ReviewBase = {
  id: string;
  /** Display name, as the customer chose to show it. */
  name: string;
  /** Whole stars out of five. */
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  /**
   * The item reviewed, as the catalog names it. For a customer review this comes from the
   * order line; the samples' items are illustrative.
   */
  product?: string;
  /**
   * The reviewer's own photo, under `public/` or the media origin, square. Optional: a card
   * without one shows the reviewer's initials instead.
   */
  avatar?: string;
};

export type Review = ReviewBase &
  (
    | { source: 'sample' }
    | {
        source: 'customer';
        /** True only when the review is tied to a delivered order. */
        verifiedPurchase: boolean;
      }
  );

export const REVIEWS: readonly Review[] = [
  {
    id: 'sample-james-carter',
    name: 'James Carter',
    rating: 5,
    text: 'Absolutely love the quality and fit! EVORA never disappoints.',
    product: 'Waxed Cotton Field Jacket',
    source: 'sample',
  },
  {
    id: 'sample-sophia-bennett',
    name: 'Sophia Bennett',
    rating: 5,
    text: 'The delivery was super fast and the packaging felt premium.',
    product: 'Camel Wool Overcoat',
    source: 'sample',
  },
  {
    id: 'sample-daniel-kim',
    name: 'Daniel Kim',
    rating: 5,
    text: 'Clean design, great products, and excellent customer service.',
    product: 'Textured Cotton Tee',
    source: 'sample',
  },
];
