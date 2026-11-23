import Image from 'next/image';

import { Container } from '@/components/layout/container';
import { RevealGroup, RevealItem } from '@/components/storefront/reveal';
import { ScrollParallax } from '@/components/storefront/scroll-motion';
import { SectionHeading } from '@/components/storefront/section-heading';

import { NewsletterForm } from './newsletter-form';
import { NEWSLETTER_ENABLED } from './subscribe';

const HEADING_ID = 'newsletter-heading';

/**
 * Newsletter banner: the campaign's dark concrete ground with the EVORA wordmark set across it at
 * a whisper, inside the page container. (It used to be a photo of clothes on a rack, which
 * repeated the Recent Arrivals rail's motif; plan.md 4.12.)
 *
 * Until sign-up has a backend (`subscribe.ts`), the banner announces the letter without a form:
 * no field asks for an address that would only be dropped (ADR 0026). Once `NEWSLETTER_ENABLED`
 * is on, the form takes the right-hand column.
 *
 * The banner carries the `dark` class, so the theme's dark tokens apply inside it whatever the
 * site theme: copy, eyebrow, form and error colours stay light-on-dark in both. Its own
 * `sand-950` fill keeps the text readable before (or without) the photo.
 *
 * The wordmark is decoration (`aria-hidden`): Brigends, letters only, sized from the frame's
 * own width (`cqw`) so it spans the frame at every size, and cut off at the foot like a stamp.
 *
 * Spacing: a framed section after another section needs only its bottom padding (the one
 * before already ends in its own). After a full-bleed band (`data-band`) it needs top padding
 * too, or the frame would sit flush against the band's edge.
 *
 * Texture: dark-concrete-texture.jpg — Peter Gargiulo, unsplash.com/photos/cGNCepznaV8 (Unsplash
 * License), shared with the campaign banner. Decorative, so `alt=""`.
 */
export function Newsletter() {
  return (
    <section aria-labelledby={HEADING_ID} className="bg-background [[data-band]+&]:pt-section-lg">
      <Container className="pb-section-lg">
        <div className="dark [container-type:inline-size] relative isolate overflow-hidden rounded-lg bg-sand-950 text-foreground">
          {/* The ground drifts against the scroll as the banner crosses the screen (GSAP owns
              the wrapper's transform; none under reduced motion). It sits darker than in the
              campaign, so the copy and the form keep their contrast anywhere on it. */}
          <ScrollParallax travel={4} className="-z-20">
            <Image
              src="/images/homepage/campaign/dark-concrete-texture.jpg"
              alt=""
              fill
              sizes="(min-width: 1680px) 1568px, (min-width: 1024px) calc(100vw - 80px), (min-width: 640px) calc(100vw - 48px), 768px"
              className="object-cover object-[50%_70%] opacity-45"
            />
          </ScrollParallax>
          <p
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 -z-10 translate-y-[22%] text-center font-display text-[19cqw] leading-none text-foreground/[0.06] select-none"
          >
            EVORA
          </p>

          {NEWSLETTER_ENABLED ? (
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
          ) : (
            <RevealGroup className="px-6 py-12 sm:px-10 sm:py-14 lg:px-16 lg:py-20 xl:px-20">
              <RevealItem>
                <SectionHeading id={HEADING_ID} eyebrow="Coming soon" title="Letters from EVORA" />
                <p className="mt-4 max-w-[52ch] text-[15px] leading-relaxed text-foreground/80">
                  An occasional letter on new arrivals and the making of each collection. Sign-up
                  opens soon.
                </p>
              </RevealItem>
            </RevealGroup>
          )}
        </div>
      </Container>
    </section>
  );
}
