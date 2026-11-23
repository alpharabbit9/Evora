import { BadgeCheck, ShoppingBag, Star } from 'lucide-react';
import Image from 'next/image';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';
import { SHOW_UNCONFIRMED_CONTENT } from '@/lib/content-gates';
import { cn } from '@/lib/utils';

import { REVIEWS, type Review } from './reviews';

const HEADING_ID = 'customer-reviews-heading';
const STARS = [1, 2, 3, 4, 5] as const;

/** One featured quote and up to two beside it. */
const MAX_REVIEWS = 3;

/**
 * Social proof on a soft sand band, between the campaign banner above and the service strip
 * below. The band is the theme's `secondary` at 60% over the page, not the full swatch:
 * `muted-foreground` text keeps AA contrast on it (≈4.6:1).
 *
 * The heading sits on the left with the sample note level with it on the right. There is no
 * "View all reviews" link: there is no reviews page to send it to yet.
 *
 * Layout: the first review is a pull quote, set large in Playfair with no card around it; up to
 * two more follow as compact cards. Phones: one column. From `sm`, the quote spans the row and
 * the cards sit side by side under it. From `lg`, the quote takes the left column and the cards
 * stack beside it, so the quote leads and the cards support it. No quotation-mark glyphs: the
 * setting makes it a quote.
 *
 * Samples are prototype copy, never customer feedback (ADR 0026). A production build drops them,
 * so the section shows only `customer` reviews there — and renders nothing until one exists.
 * Wherever samples are shown (development, or a staging review with the content flag on), the
 * note says so. It disappears by itself once only `customer` reviews are passed in.
 *
 * The heading and cards reveal with `RevealGroup` (GSAP ScrollTrigger), one card after another,
 * fading in place (`items="fade"`).
 *
 * `data-band` marks the full-bleed tinted band, so a framed section after it can add the top
 * spacing a band needs (see `Newsletter`).
 */
export function CustomerReviews({ reviews = REVIEWS }: { reviews?: readonly Review[] }) {
  const visible = SHOW_UNCONFIRMED_CONTENT
    ? reviews
    : reviews.filter((review) => review.source === 'customer');
  if (visible.length === 0) return null;

  const hasSamples = visible.some((review) => review.source === 'sample');
  const [featured, ...rest] = visible.slice(0, MAX_REVIEWS);

  return (
    <section data-band aria-labelledby={HEADING_ID} className="bg-secondary/60 text-foreground">
      <Container className="py-section-lg">
        {/* `items="fade"`: the quotes settle in place, so this band does not repeat the
            campaign's rise just above it. */}
        <RevealGroup items="fade">
          <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
            <RevealItem>
              <SectionHeading
                id={HEADING_ID}
                eyebrow="What our customers say"
                title="Real People. Real Style."
              />
            </RevealItem>
            {hasSamples ? (
              <RevealItem>
                <p className="text-[10px] font-semibold tracking-[0.22em] text-muted-foreground uppercase">
                  Sample reviews for preview
                </p>
              </RevealItem>
            ) : null}
          </div>

          <ul
            className={cn(
              'mt-10 grid gap-4 sm:mt-12 sm:gap-5 lg:gap-x-16 lg:gap-y-6',
              rest.length > 0 && 'sm:grid-cols-2 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]',
            )}
          >
            <RevealItem
              as="li"
              // Stacked above the cards, the quote needs more room below it than the grid gap.
              className={cn(
                'flex pb-6 sm:col-span-2 lg:col-span-1 lg:pb-0',
                rest.length > 1 && 'lg:row-span-2',
              )}
            >
              <FeaturedReview review={featured} />
            </RevealItem>
            {rest.map((review) => (
              <RevealItem key={review.id} as="li" className="flex">
                <ReviewCard review={review} />
              </RevealItem>
            ))}
          </ul>
        </RevealGroup>
      </Container>
    </section>
  );
}

/**
 * The lead review: the quote in Playfair at a reading-display size over a hairline, and the
 * reviewer with the item underneath. Not a card: on the band it reads as an editorial pull quote.
 */
function FeaturedReview({ review }: { review: Review }) {
  return (
    <figure className="flex w-full flex-col gap-8 border-t border-foreground/15 pt-8 lg:gap-10">
      <blockquote className="max-w-[28ch] font-heading text-[clamp(1.5rem,1.2rem+1.3vw,2.375rem)] leading-[1.22] font-normal tracking-[-0.01em] text-balance">
        <p>&ldquo;{review.text}&rdquo;</p>
      </blockquote>
      <figcaption className="flex flex-col gap-4">
        <span className="flex min-w-0 items-center gap-3.5">
          <Avatar review={review} />
          <span className="min-w-0">
            <span className="block truncate text-sm leading-5 font-semibold">{review.name}</span>
            <StarRating rating={review.rating} />
          </span>
        </span>
        <ReviewMeta review={review} className="mt-0 border-0 pt-0" />
      </figcaption>
    </figure>
  );
}

/**
 * A compact card: the reviewer (avatar, name, stars) across the top, the quote below, and the
 * item reviewed ruled off at the foot.
 *
 * The card is not a link, so it must not move or change the cursor on hover; it firms up its
 * border and lifts a soft shadow, all CSS. GSAP owns the list item's opacity and transform (its
 * entrance), never this element's.
 *
 * Dark mode sets the card in the page colour, a step below the band: the dark `card` token is
 * the band's own shade there, and would leave only a faint outline.
 */
function ReviewCard({ review }: { review: Review }) {
  return (
    <figure className="flex w-full flex-col rounded-lg border border-border/70 bg-card p-6 text-card-foreground shadow-[0_1px_2px_rgb(0_0_0/0.04)] transition-[border-color,box-shadow] duration-500 hover:border-foreground/20 hover:shadow-[0_18px_40px_-20px_rgb(0_0_0/0.25)] sm:p-7 dark:bg-background">
      <figcaption className="flex min-w-0 items-center gap-3.5">
        <Avatar review={review} />
        <span className="min-w-0">
          <span className="block truncate text-sm leading-5 font-semibold">{review.name}</span>
          <StarRating rating={review.rating} />
        </span>
      </figcaption>

      <blockquote className="mt-5 flex-1 text-[15px] leading-7 text-pretty text-foreground/80">
        <p>{review.text}</p>
      </blockquote>

      <ReviewMeta review={review} />
    </figure>
  );
}

/**
 * The reviewer's own photo when they gave one, otherwise their initials in a monogram. Never a
 * stock portrait: a recognisable stranger beside a quote reads as an endorsement (`reviews.ts`).
 * Decorative either way; the name beside it is the accessible text.
 */
function Avatar({ review }: { review: Review }) {
  if (review.avatar) {
    return (
      <span className="relative size-11 shrink-0 overflow-hidden rounded-full ring-1 ring-border">
        <Image src={review.avatar} alt="" fill sizes="44px" className="object-cover" />
      </span>
    );
  }
  return (
    <span
      aria-hidden="true"
      className="grid size-11 shrink-0 place-items-center rounded-full bg-foreground font-heading text-[15px] tracking-[0.04em] text-background ring-4 ring-secondary/70"
    >
      {initials(review.name)}
    </span>
  );
}

/** Stars in the ink colour: the palette has no accent hue, and amber was the only one. */
function StarRating({ rating }: { rating: Review['rating'] }) {
  return (
    <span className="mt-1 flex items-center gap-2">
      <span className="sr-only">Rated {rating} out of 5</span>
      <span aria-hidden="true" className="flex items-center gap-0.5">
        {STARS.map((star) => (
          <Star
            key={star}
            strokeWidth={1.25}
            className={cn(
              'size-3.5',
              star <= rating ? 'fill-foreground text-foreground' : 'text-foreground/25',
            )}
          />
        ))}
      </span>
    </span>
  );
}

/**
 * At the foot: the item reviewed, then "Verified purchase" for a customer review tied to a
 * delivered order. Samples are never verified (the type forbids it); that they are samples is
 * said once for the section, not on every card.
 */
function ReviewMeta({ review, className }: { review: Review; className?: string }) {
  const verified = review.source === 'customer' && review.verifiedPurchase;
  if (!review.product && !verified) return null;

  return (
    <p
      className={cn(
        'mt-6 flex min-w-0 flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-4 text-xs leading-5 text-muted-foreground',
        className,
      )}
    >
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
    </p>
  );
}

/** "Sophia Bennett" → "SB": first and last word. Code points, so no letter is split in two. */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const picked = words.length > 1 ? [words[0], words[words.length - 1]] : words;
  return picked.map((word) => Array.from(word)[0].toUpperCase()).join('');
}
