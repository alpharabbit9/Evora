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
 * Photos: illustrative stock shots, not the reviewers, and chosen so that nobody in them can
 * be recognised (seen from behind, faces turned away). That is deliberate and must stay so
 * for any stock image used here: a recognisable stranger beside a quote presents that person
 * as endorsing the store, which neither licence below allows (the Unsplash Terms exclude
 * recognisable people from the licence; Pexels forbids implied endorsement). A customer's own
 * photo needs their consent. Images are decorative (`alt: ''`): the quote and name carry the
 * card. All Unsplash License, cropped to 4:3 and resized to 1200 × 900:
 *
 * - man-in-coat-at-shop-window.jpg — Mathias Reding (unsplash.com/@matreding),
 *   unsplash.com/photos/9iLMPbZUwl0
 * - woman-in-camel-coat-walking.jpg — Mikhail Tyrsyna (unsplash.com/@tventos),
 *   unsplash.com/photos/cod_x1dNWDs
 * - man-walking-in-stone-square.jpg — Hooman R. (unsplash.com/@hooman_r),
 *   unsplash.com/photos/vAxUhNQre3M
 */

export type ReviewImage = {
  /** Under `public/`, 4:3. */
  src: string;
  /** Empty for an illustrative photo; describe it only when it shows the reviewer's own look. */
  alt: string;
};

type ReviewBase = {
  id: string;
  /** Display name, as the customer chose to show it. */
  name: string;
  /** Whole stars out of five. */
  rating: 1 | 2 | 3 | 4 | 5;
  text: string;
  /**
   * The item reviewed, as the catalog names it. For a customer review this comes from the
   * order line; the samples' items are illustrative, chosen to match their photos.
   */
  product?: string;
  /** Optional: a card without one shows the reviewer's initials instead. */
  image?: ReviewImage;
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
    image: { src: '/images/homepage/reviews/man-in-coat-at-shop-window.jpg', alt: '' },
    source: 'sample',
  },
  {
    id: 'sample-sophia-bennett',
    name: 'Sophia Bennett',
    rating: 5,
    text: 'The delivery was super fast and the packaging felt premium.',
    product: 'Camel Wool Overcoat',
    image: { src: '/images/homepage/reviews/woman-in-camel-coat-walking.jpg', alt: '' },
    source: 'sample',
  },
  {
    id: 'sample-daniel-kim',
    name: 'Daniel Kim',
    rating: 5,
    text: 'Clean design, great products, and excellent customer service.',
    product: 'Textured Cotton Tee',
    image: { src: '/images/homepage/reviews/man-walking-in-stone-square.jpg', alt: '' },
    source: 'sample',
  },
];
