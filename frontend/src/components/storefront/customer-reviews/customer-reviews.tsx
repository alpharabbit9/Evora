import { BadgeCheck, ShoppingBag, Star } from 'lucide-react';
import Image from 'next/image';

import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { cn } from '@/lib/utils';

import { REVIEWS, type Review } from './reviews';

const HEADING_ID = 'customer-reviews-heading';
const STARS = [1, 2, 3, 4, 5] as const;

/** The card's rendered width at each layout of the grid below, for `next/image`. */
const IMAGE_SIZES =
  '(min-width: 1680px) 507px, (min-width: 1024px) calc((100vw - 128px) / 3), (min-width: 640px) calc((100vw - 68px) / 2), calc(100vw - 32px)';

/**
 * Social proof: testimonial cards on a soft sand band, between the light sections above and
 * the dark newsletter below. The band is the theme's `secondary` at 60% over the page, not the
 * full swatch: `muted-foreground` text (the eyebrow) keeps AA contrast on it (≈4.6:1; ≈4.4:1
 * on full `secondary`).
 *
 * Layout: one column on phones. From `sm`, a 2 + 1 arrangement on a four-track grid: cards
 * span two tracks, and an odd card out is centred under the pair at the same width. From `lg`,
 * one row of three. The grid stretches cards in a row to one height, and each card's footer
 * sits at its bottom, so names line up across the row.
 *
 * While any review is a prototype sample, one note under the cards says so (and that the
 * photos are illustrative, when there are any): fictional quotes must not pass as customer
 * feedback. It disappears by itself once only `customer` reviews are passed in.
 *
 * Renders nothing without reviews: an empty testimonial block helps nobody.
 */
export function CustomerReviews({ reviews = REVIEWS }: { reviews?: readonly Review[] }) {
  if (reviews.length === 0) return null;

  const hasSamples = reviews.some((review) => review.source === 'sample');
  const hasPhotos = reviews.some((review) => review.image);

  return (
    <section aria-labelledby={HEADING_ID} className="bg-secondary/60 text-foreground">
      <div className="mx-auto w-full max-w-[1680px] px-4 py-[clamp(3.5rem,2.5rem+4vw,6.5rem)] sm:px-6 lg:px-10 xl:px-14">
        <RevealGroup>
          <RevealItem>
            <SectionHeading
              id={HEADING_ID}
              eyebrow="What our customers say"
              title="Real People. Real Style."
            />
          </RevealItem>

          <ul className="mt-10 grid gap-4 sm:mt-12 sm:grid-cols-4 sm:gap-5 lg:grid-cols-3 lg:gap-6 xl:mt-14">
            {reviews.map((review) => (
              <RevealItem
                key={review.id}
                as="li"
                className="flex sm:col-span-2 sm:last:odd:col-start-2 lg:col-span-1 lg:last:odd:col-start-auto"
              >
                <ReviewCard review={review} />
              </RevealItem>
            ))}
          </ul>

          {hasSamples ? (
            <RevealItem>
              <p className="mt-6 text-xs leading-5 text-muted-foreground sm:mt-8">
                Sample reviews for preview.{hasPhotos ? ' Photos are illustrative.' : null}
              </p>
            </RevealItem>
          ) : null}
        </RevealGroup>
      </div>
    </section>
  );
}

/**
 * An editorial card: a 4:3 photograph over the quote, set in Playfair under a large hanging
 * quotation mark, with the name ruled off at the foot. A review without a photo keeps the
 * same body and shows the reviewer's initials beside the name instead.
 */
function ReviewCard({ review }: { review: Review }) {
  const { image } = review;

  return (
    // The hover firms up the border, lifts a soft shadow and slowly pushes into the photo:
    // the card is not a link, so the card itself must not move or change cursor. Framer owns
    // the list item's opacity and transform; the border, shadow and the photo's scale are CSS
    // on elements inside it.
    //
    // Dark mode sets the card in the page colour, a step below the band: the dark `card` token
    // is the band's own shade there, and would leave only a faint outline.
    <figure className="group flex w-full flex-col overflow-hidden rounded-md border border-border bg-card text-card-foreground transition-[border-color,box-shadow] duration-500 hover:border-foreground/20 hover:shadow-md dark:bg-background">
      {image ? (
        <div className="relative aspect-[4/3] overflow-hidden bg-secondary">
          <Image
            src={image.src}
            alt={image.alt}
            fill
            sizes={IMAGE_SIZES}
            // Slightly muted, so three photos from different shoots sit together on the band.
            className="object-cover saturate-[0.85] transition-transform duration-[1200ms] ease-[cubic-bezier(0.16,1,0.3,1)] group-hover:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100"
          />
        </div>
      ) : null}

      <div className="flex flex-1 flex-col p-6 sm:p-7 xl:p-8">
        <div className="flex items-start justify-between gap-4">
          <StarRating rating={review.rating} />
          {/* Decorative: the blockquote already marks the text as quoted. */}
          <span
            aria-hidden="true"
            className="-mt-1 -mb-6 font-heading text-[3.5rem] leading-none text-foreground/15 select-none"
          >
            &ldquo;
          </span>
        </div>

        <blockquote className="mt-5 flex-1 font-heading text-[clamp(1.125rem,1.05rem+0.35vw,1.375rem)] leading-[1.5] text-pretty">
          <p>{review.text}</p>
        </blockquote>

        <figcaption className="mt-7 flex items-center gap-3.5 border-t border-border pt-5">
          {image ? null : (
            // Decorative: the name beside it is the accessible text.
            <span
              aria-hidden="true"
              className="grid size-10 shrink-0 place-items-center rounded-full bg-secondary text-[11px] font-semibold tracking-[0.08em] text-secondary-foreground"
            >
              {initials(review.name)}
            </span>
          )}
          <span className="min-w-0">
            <span className="block truncate text-[11px] leading-5 font-semibold tracking-[0.18em] uppercase">
              {review.name}
            </span>
            <ReviewMeta review={review} />
          </span>
        </figcaption>
      </div>
    </figure>
  );
}

function StarRating({ rating }: { rating: Review['rating'] }) {
  return (
    <p className="flex items-center gap-2.5">
      <span className="sr-only">Rated {rating} out of 5</span>
      <span aria-hidden="true" className="flex items-center gap-1">
        {STARS.map((star) => (
          <Star
            key={star}
            strokeWidth={1.25}
            className={cn('size-3.5', star <= rating ? 'fill-current' : 'text-foreground/25')}
          />
        ))}
      </span>
      <span aria-hidden="true" className="text-xs font-medium text-muted-foreground tabular-nums">
        {rating.toFixed(1)}
      </span>
    </p>
  );
}

/**
 * Under the name: the item reviewed, then "Verified purchase" for a customer review tied to
 * a delivered order. Samples are never verified (the type forbids it); that they are samples
 * is said once for the section, not on every card.
 */
function ReviewMeta({ review }: { review: Review }) {
  const verified = review.source === 'customer' && review.verifiedPurchase;
  if (!review.product && !verified) return null;

  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs leading-5 text-muted-foreground">
      {review.product ? (
        <span className="flex min-w-0 items-center gap-1.5">
          <ShoppingBag aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" />
          <span className="sr-only">Purchased: </span>
          <span className="truncate">{review.product}</span>
        </span>
      ) : null}
      {verified ? (
        <span className="flex items-center gap-1.5">
          <BadgeCheck aria-hidden="true" strokeWidth={1.5} className="size-3.5 shrink-0" />
          Verified purchase
        </span>
      ) : null}
    </span>
  );
}

/** "Sophia Bennett" → "SB": first and last word. Code points, so no letter is split in two. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((word) => Array.from(word)[0].toUpperCase()).join('');
}
