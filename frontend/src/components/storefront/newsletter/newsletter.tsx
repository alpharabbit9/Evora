import Image from 'next/image';

import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { SectionHeading } from '@/components/storefront/section-heading';

import { NewsletterForm } from './newsletter-form';

const HEADING_ID = 'newsletter-heading';

/**
 * Newsletter banner: a photograph under a black overlay, inside the page container.
 *
 * The banner carries the `dark` class, so the theme's dark tokens apply inside it whatever the
 * site theme: copy, eyebrow, form and error colours stay light-on-dark in both. Its own
 * `sand-950` fill keeps the text readable before (or without) the photo.
 *
 * Photo: "Black clothes hanged in rack" by No Revisions (unsplash.com/@norevisions,
 * unsplash.com/photos/kWVImL5QxJI), Unsplash License; resized to 2400px. Decorative, so `alt=""`.
 */
export function Newsletter() {
  return (
    <section aria-labelledby={HEADING_ID} className="bg-background">
      <div className="mx-auto w-full max-w-[1680px] px-4 py-[clamp(3.5rem,2.5rem+4vw,6.5rem)] sm:px-6 lg:px-10 xl:px-14">
        <div className="dark relative isolate overflow-hidden rounded-lg bg-sand-950 text-foreground">
          <Image
            src="/images/homepage/newsletter/black-garments-on-rack.jpg"
            alt=""
            fill
            sizes="(min-width: 1680px) 1568px, (min-width: 1024px) calc(100vw - 80px), (min-width: 640px) calc(100vw - 48px), 768px"
            className="-z-20 object-cover object-[50%_45%]"
          />
          {/* Overlay: the theme's on-image black, then extra weight behind the copy (left on
              wide screens, the whole column on phones). The lightest point, the bare wall
              behind the form, still keeps the form's placeholder and status text above 4.5:1. */}
          <div aria-hidden="true" className="absolute inset-0 -z-10 bg-(--overlay)" />
          <div
            aria-hidden="true"
            className="absolute inset-0 -z-10 bg-linear-to-b from-sand-950/45 to-sand-950/60 md:bg-linear-to-r md:from-sand-950/75 md:via-sand-950/35 md:to-sand-950/30"
          />

          <RevealGroup className="grid gap-8 px-6 py-12 sm:px-10 sm:py-14 lg:grid-cols-[minmax(0,1fr)_minmax(0,30rem)] lg:items-center lg:gap-16 lg:px-16 lg:py-20 xl:px-20">
            <RevealItem>
              <SectionHeading
                id={HEADING_ID}
                eyebrow="Stay in the loop"
                title="Join Our Newsletter"
              />
              <p className="mt-4 max-w-[46ch] text-[15px] leading-relaxed text-foreground/80">
                Be the first to know about new arrivals, exclusive offers and more.
              </p>
            </RevealItem>
            <RevealItem>
              <NewsletterForm />
            </RevealItem>
          </RevealGroup>
        </div>
      </div>
    </section>
  );
}
